// Importe l'ancien fichier data/db.json dans le compte d'un utilisateur PostgreSQL
// Utilisation : node --env-file=.env scripts/import-json.js <nom_utilisateur> [fichier.json]
// Les mois vides sont ignorés ; un mois déjà rempli dans le compte n'est jamais écrasé.
const fs = require('fs');
const path = require('path');
const { pool, init, transaction } = require('../db');

// "2026-10" -> "Octobre 2026"
function monthTitle(ym) {
  const t = new Date(ym + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t[0].toUpperCase() + t.slice(1);
}

// ancien format (période libre, ex : 4 oct -> 21 nov) : découpé en mois
function toMonths(periods) {
  const out = [];
  for (const p of periods) {
    if (p.month) { out.push(p); continue; }
    for (let ym = p.start.slice(0, 7); ym <= p.end.slice(0, 7);) {
      const inMonth = d => d.startsWith(ym);
      out.push({
        month: ym,
        title: monthTitle(ym),
        goal: null,
        notes: ym === p.start.slice(0, 7) ? p.notes : '',
        habits: p.habits,
        checks: Object.fromEntries(Object.entries(p.checks).filter(([k]) => inMonth(k.split('|')[1]))),
        mood: Object.fromEntries(Object.entries(p.mood).filter(([d]) => inMonth(d))),
        weight: Object.fromEntries(Object.entries(p.weight).filter(([d]) => inMonth(d))),
      });
      const [y, m] = ym.split('-').map(Number);
      ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  }
  return out;
}

async function main() {
  const [username, file = path.join(__dirname, '..', 'data', 'db.json')] = process.argv.slice(2);
  if (!username) throw new Error('Usage : node --env-file=.env scripts/import-json.js <nom_utilisateur> [fichier.json]');

  await init();
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
  if (!rows[0]) throw new Error(`Utilisateur "${username}" introuvable : crée d'abord le compte sur le site`);
  const userId = rows[0].id;

  const periods = toMonths(JSON.parse(fs.readFileSync(file, 'utf8')).periods);
  for (const p of periods) {
    const hasData = Object.keys(p.checks).length || Object.keys(p.mood).length
      || Object.keys(p.weight).length || p.notes;
    if (!hasData) { console.log(`${p.month} : vide, ignoré`); continue; }

    const imported = await transaction(async client => {
      // un mois déjà présent mais vide (ouvert sur le site sans rien cocher) est remplacé
      const existing = await client.query(`
        SELECT m.id, (
          EXISTS (SELECT 1 FROM checks c JOIN habits h ON h.id = c.habit_id WHERE h.month_id = m.id)
          OR EXISTS (SELECT 1 FROM moods WHERE month_id = m.id)
          OR EXISTS (SELECT 1 FROM weights WHERE month_id = m.id)
          OR m.notes <> '') AS has_data
        FROM months m WHERE m.user_id = $1 AND m.month = $2`, [userId, p.month]);
      if (existing.rows[0]) {
        if (existing.rows[0].has_data) return false;
        await client.query('DELETE FROM months WHERE id = $1', [existing.rows[0].id]);
      }
      const m = await client.query(
        'INSERT INTO months (user_id, month, title, goal, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, p.month, p.title, p.goal, p.notes || ''],
      );
      const monthId = m.rows[0].id;

      const newId = {}; // ancien id d'habitude -> nouvel id SQL
      for (const [i, h] of p.habits.entries()) {
        const r = await client.query(
          'INSERT INTO habits (month_id, name, position) VALUES ($1, $2, $3) RETURNING id', [monthId, h.name, i]);
        newId[h.id] = r.rows[0].id;
      }
      for (const [key, value] of Object.entries(p.checks)) {
        const [habitId, day] = key.split('|');
        if (newId[habitId]) {
          await client.query('INSERT INTO checks (habit_id, day, value) VALUES ($1, $2, $3)', [newId[habitId], day, value]);
        }
      }
      for (const [day, value] of Object.entries(p.mood)) {
        await client.query('INSERT INTO moods (month_id, day, value) VALUES ($1, $2, $3)', [monthId, day, value]);
      }
      for (const [day, kg] of Object.entries(p.weight)) {
        await client.query('INSERT INTO weights (month_id, day, kg) VALUES ($1, $2, $3)', [monthId, day, kg]);
      }
      return true;
    });
    console.log(imported
      ? `${p.month} : importé (${Object.keys(p.checks).length} cases)`
      : `${p.month} : existe déjà dans le compte, ignoré`);
  }
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
