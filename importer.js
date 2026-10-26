// Import d'un ancien fichier JSON (format data/db.json) dans le compte d'un utilisateur.
// Utilisé par la route POST /api/import et par scripts/import-json.js.
// Le fichier vient de l'utilisateur : tout est vérifié, les données invalides sont ignorées.
const { transaction } = require('./db');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONTHS = 60;
const MAX_HABITS = 40;

// "2026-10" -> "Octobre 2026"
function monthTitle(ym) {
  const t = new Date(ym + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t[0].toUpperCase() + t.slice(1);
}

function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// vrai si date est un vrai jour ("YYYY-MM-DD") du mois ym
function isDayOf(ym, date) {
  if (typeof date !== 'string' || !DATE_RE.test(date) || !date.startsWith(ym)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === date;
}

const entries = obj => (obj && typeof obj === 'object' ? Object.entries(obj) : []);

// périodes du fichier -> liste de mois propres
// (l'ancien format "période libre", ex : 4 oct -> 21 nov, est découpé en mois)
function toMonths(periods) {
  const out = [];
  for (const p of Array.isArray(periods) ? periods : []) {
    if (!p || typeof p !== 'object') continue;
    let months = [];
    if (MONTH_RE.test(p.month)) months = [p.month];
    else if (DATE_RE.test(p.start) && DATE_RE.test(p.end) && p.start <= p.end) {
      for (let ym = p.start.slice(0, 7); ym <= p.end.slice(0, 7) && months.length < MAX_MONTHS; ym = nextMonth(ym)) months.push(ym);
    }
    const habits = (Array.isArray(p.habits) ? p.habits : [])
      .filter(h => h && typeof h.name === 'string' && h.name.trim())
      .slice(0, MAX_HABITS)
      .map(h => ({ id: String(h.id), name: h.name.trim().slice(0, 60) }));

    months.forEach((ym, i) => out.push({
      month: ym,
      title: p.month && typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 60) : monthTitle(ym),
      goal: p.month && Number(p.goal) > 0 ? Math.min(Math.round(Number(p.goal)), 100000) : null,
      notes: i === 0 && typeof p.notes === 'string' ? p.notes.slice(0, 5000) : '',
      habits,
      checks: entries(p.checks).filter(([k, v]) => ['done', 'miss'].includes(v) && isDayOf(ym, k.split('|')[1])),
      moods: entries(p.mood).filter(([d, v]) => [1, 2, 3].includes(v) && isDayOf(ym, d)),
      weights: entries(p.weight).filter(([d, v]) => Number(v) > 0 && Number(v) < 500 && isDayOf(ym, d)),
    }));
  }
  return out.slice(0, MAX_MONTHS);
}

// importe dans le compte userId ; un mois déjà rempli n'est jamais écrasé,
// un mois existant mais vide (ouvert sur le site sans rien cocher) est remplacé
async function importForUser(userId, periods) {
  const results = [];
  for (const p of toMonths(periods)) {
    if (!p.checks.length && !p.moods.length && !p.weights.length && !p.notes) {
      results.push({ month: p.month, status: 'vide' });
      continue;
    }
    const checks = await transaction(async client => {
      const existing = await client.query(`
        SELECT m.id, (
          EXISTS (SELECT 1 FROM checks c JOIN habits h ON h.id = c.habit_id WHERE h.month_id = m.id)
          OR EXISTS (SELECT 1 FROM moods WHERE month_id = m.id)
          OR EXISTS (SELECT 1 FROM weights WHERE month_id = m.id)
          OR m.notes <> '') AS has_data
        FROM months m WHERE m.user_id = $1 AND m.month = $2`, [userId, p.month]);
      if (existing.rows[0]) {
        if (existing.rows[0].has_data) return null;
        await client.query('DELETE FROM months WHERE id = $1', [existing.rows[0].id]);
      }

      const m = await client.query(
        'INSERT INTO months (user_id, month, title, goal, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, p.month, p.title, p.goal, p.notes],
      );
      const monthId = m.rows[0].id;

      const newId = {}; // ancien id d'habitude -> nouvel id SQL
      for (const [i, h] of p.habits.entries()) {
        const r = await client.query(
          'INSERT INTO habits (month_id, name, position) VALUES ($1, $2, $3) RETURNING id', [monthId, h.name, i]);
        newId[h.id] = r.rows[0].id;
      }

      // insertion en une seule requête par table (unnest = tableau -> lignes)
      const rows = p.checks.filter(([k]) => newId[k.split('|')[0]]);
      await client.query(
        `INSERT INTO checks (habit_id, day, value)
         SELECT * FROM unnest($1::int[], $2::date[], $3::text[]) ON CONFLICT DO NOTHING`,
        [rows.map(([k]) => newId[k.split('|')[0]]), rows.map(([k]) => k.split('|')[1]), rows.map(([, v]) => v)],
      );
      await client.query(
        `INSERT INTO moods (month_id, day, value)
         SELECT $1, d, v FROM unnest($2::date[], $3::smallint[]) AS t(d, v)`,
        [monthId, p.moods.map(([d]) => d), p.moods.map(([, v]) => v)],
      );
      await client.query(
        `INSERT INTO weights (month_id, day, kg)
         SELECT $1, d, k FROM unnest($2::date[], $3::numeric[]) AS t(d, k)`,
        [monthId, p.weights.map(([d]) => d), p.weights.map(([, v]) => Math.round(Number(v) * 10) / 10)],
      );
      return rows.length;
    });
    results.push(checks === null
      ? { month: p.month, status: 'déjà rempli' }
      : { month: p.month, status: 'importé', checks });
  }
  return results;
}

module.exports = { importForUser };
