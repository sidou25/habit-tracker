// Mois, habitudes, cases, humeur, poids : chaque requête est limitée à l'utilisateur connecté
const express = require('express');
const { pool, transaction } = require('../db');
const { requireAuth, wrap } = require('./auth');
const { importForUser } = require('../importer');

const router = express.Router();
router.use(requireAuth);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CELL_VALUES = ['done', 'miss'];
const MAX_HABITS = 40;
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
// habitudes proposées au tout premier mois d'un nouveau compte
const DEFAULT_HABITS = ['Se lever avant 8h', 'Étudier', 'Sport', 'Lire 20 min', 'Boire 2 L d\'eau', 'Dormir avant 23h'];

// ---------- Utilitaires ----------

function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
}

const monthTitle = ym => `${MONTH_NAMES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

// vrai si date est un vrai jour ("YYYY-MM-DD") du mois ym
function isDayOf(ym, date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(ym)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === date;
}

// identifiant SQL valide (entier positif) ou null
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null;
}

function cleanName(name) {
  return typeof name === 'string' ? name.trim().slice(0, 60) : '';
}

const habitsJson = rows => rows.map(h => ({ id: String(h.id), name: h.name }));

// le mois complet, au format attendu par le front-end
async function loadPeriod(m) {
  const [habits, checks, moods, weights] = await Promise.all([
    pool.query('SELECT id, name FROM habits WHERE month_id = $1 ORDER BY position, id', [m.id]),
    pool.query(`SELECT c.habit_id, c.day, c.value FROM checks c
                JOIN habits h ON h.id = c.habit_id WHERE h.month_id = $1`, [m.id]),
    pool.query('SELECT day, value FROM moods WHERE month_id = $1', [m.id]),
    pool.query('SELECT day, kg FROM weights WHERE month_id = $1', [m.id]),
  ]);
  const { start, end } = monthBounds(m.month);
  return {
    id: String(m.id),
    month: m.month,
    title: m.title,
    start,
    end,
    goal: m.goal,
    habits: habitsJson(habits.rows),
    checks: Object.fromEntries(checks.rows.map(c => [`${c.habit_id}|${c.day}`, c.value])),
    mood: Object.fromEntries(moods.rows.map(r => [r.day, r.value])),
    weight: Object.fromEntries(weights.rows.map(r => [r.day, Number(r.kg)])),
    notes: m.notes,
  };
}

// le mois :id, seulement s'il appartient à l'utilisateur connecté (sinon 404)
async function ownMonth(req, res) {
  const id = toId(req.params.id);
  const { rows } = id
    ? await pool.query('SELECT * FROM months WHERE id = $1 AND user_id = $2', [id, req.session.userId])
    : { rows: [] };
  if (!rows[0]) res.status(404).json({ error: 'Mois introuvable' });
  return rows[0];
}

// ---------- Mois ----------

// résumé de tous les mois de l'utilisateur (pour les onglets)
router.get('/months', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT m.id, m.month, m.title, m.goal,
      (SELECT count(*) FROM habits h WHERE h.month_id = m.id)::int AS habit_count,
      (SELECT count(*) FROM checks c JOIN habits h ON h.id = c.habit_id
        WHERE h.month_id = m.id AND c.value = 'done')::int AS done
    FROM months m WHERE m.user_id = $1 ORDER BY m.month`, [req.session.userId]);
  res.json(rows.map(r => ({
    id: String(r.id),
    month: r.month,
    title: r.title,
    done: r.done,
    goal: r.goal || r.habit_count * monthBounds(r.month).days,
  })));
}));

// ouvre un mois ; s'il n'existe pas, il est créé avec les habitudes du mois le plus proche
router.post('/months/:ym', wrap(async (req, res) => {
  const ym = req.params.ym;
  if (!MONTH_RE.test(ym)) return res.status(400).json({ error: 'Mois invalide' });
  const userId = req.session.userId;

  const found = await pool.query('SELECT * FROM months WHERE user_id = $1 AND month = $2', [userId, ym]);
  if (found.rows[0]) return res.json(await loadPeriod(found.rows[0]));

  const created = await transaction(async client => {
    const ins = await client.query(
      `INSERT INTO months (user_id, month, title) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, month) DO NOTHING RETURNING *`,
      [userId, ym, monthTitle(ym)],
    );
    const m = ins.rows[0];
    if (!m) return null; // une autre requête l'a créé au même moment

    // d'abord le mois précédent le plus proche, sinon le suivant le plus proche
    const src = await client.query(`
      SELECT m.id FROM months m
      WHERE m.user_id = $1 AND m.id <> $2
        AND EXISTS (SELECT 1 FROM habits h WHERE h.month_id = m.id)
      ORDER BY (m.month > $3), CASE WHEN m.month < $3 THEN m.month END DESC, m.month
      LIMIT 1`, [userId, m.id, ym]);
    if (src.rows[0]) {
      await client.query(
        `INSERT INTO habits (month_id, name, position)
         SELECT $1, name, position FROM habits WHERE month_id = $2`,
        [m.id, src.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO habits (month_id, name, position)
         SELECT $1, name, ord - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(name, ord)`,
        [m.id, DEFAULT_HABITS],
      );
    }
    return m;
  });

  const m = created
    || (await pool.query('SELECT * FROM months WHERE user_id = $1 AND month = $2', [userId, ym])).rows[0];
  res.status(created ? 201 : 200).json(await loadPeriod(m));
}));

router.put('/periods/:id', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const { title, goal, notes } = req.body;
  let newTitle = m.title;
  if (title !== undefined) {
    newTitle = cleanName(title);
    if (!newTitle) return res.status(400).json({ error: 'Titre vide' });
  }
  const newGoal = goal === undefined ? m.goal : (Number(goal) > 0 ? Math.min(Math.round(Number(goal)), 100000) : null);
  const newNotes = notes === undefined ? m.notes : String(notes).slice(0, 5000);
  await pool.query('UPDATE months SET title = $1, goal = $2, notes = $3 WHERE id = $4',
    [newTitle, newGoal, newNotes, m.id]);
  res.json({ title: newTitle, goal: newGoal, notes: newNotes });
}));

// réinitialise un mois : il sera recréé à la prochaine ouverture
router.delete('/periods/:id', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  await pool.query('DELETE FROM months WHERE id = $1', [m.id]); // CASCADE : habitudes, cases, humeur, poids
  res.status(204).end();
}));

// ---------- Habitudes ----------

router.post('/periods/:id/habits', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Nom vide' });
  const count = await pool.query('SELECT count(*)::int AS n FROM habits WHERE month_id = $1', [m.id]);
  if (count.rows[0].n >= MAX_HABITS) return res.status(400).json({ error: `Maximum ${MAX_HABITS} habitudes par mois` });
  const { rows } = await pool.query(
    `INSERT INTO habits (month_id, name, position)
     SELECT $1, $2, COALESCE(MAX(position) + 1, 0) FROM habits WHERE month_id = $1
     RETURNING id, name`,
    [m.id, name],
  );
  res.status(201).json(habitsJson(rows)[0]);
}));

router.put('/periods/:id/habits/:hid', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Nom vide' });
  const { rows } = await pool.query(
    'UPDATE habits SET name = $1 WHERE id = $2 AND month_id = $3 RETURNING id, name',
    [name, toId(req.params.hid), m.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Habitude introuvable' });
  res.json(habitsJson(rows)[0]);
}));

// déplacer une habitude vers le haut (-1) ou le bas (+1)
router.post('/periods/:id/habits/:hid/move', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const hid = toId(req.params.hid);
  const dir = req.body.dir === -1 ? -1 : 1;
  const moved = await transaction(async client => {
    const { rows } = await client.query(
      'SELECT id FROM habits WHERE month_id = $1 ORDER BY position, id FOR UPDATE', [m.id]);
    const ids = rows.map(r => r.id);
    const i = ids.indexOf(hid);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return false;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // position = rang dans la nouvelle liste
    await client.query(
      `UPDATE habits h SET position = t.ord
       FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord) WHERE h.id = t.id`,
      [ids],
    );
    return true;
  });
  if (!moved) return res.status(400).json({ error: 'Déplacement impossible' });
  const { rows } = await pool.query('SELECT id, name FROM habits WHERE month_id = $1 ORDER BY position, id', [m.id]);
  res.json(habitsJson(rows));
}));

router.delete('/periods/:id/habits/:hid', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  await pool.query('DELETE FROM habits WHERE id = $1 AND month_id = $2', [toId(req.params.hid), m.id]);
  res.status(204).end();
}));

// ---------- Cases, humeur, poids ----------

router.put('/periods/:id/checks', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const hid = toId(req.body.habitId);
  const { date, value } = req.body;
  const habit = hid && await pool.query('SELECT 1 FROM habits WHERE id = $1 AND month_id = $2', [hid, m.id]);
  if (!habit || !habit.rowCount || !isDayOf(m.month, date)) return res.status(400).json({ error: 'Case invalide' });

  if (CELL_VALUES.includes(value)) {
    await pool.query(
      `INSERT INTO checks (habit_id, day, value) VALUES ($1, $2, $3)
       ON CONFLICT (habit_id, day) DO UPDATE SET value = EXCLUDED.value`,
      [hid, date, value],
    );
  } else {
    await pool.query('DELETE FROM checks WHERE habit_id = $1 AND day = $2', [hid, date]);
  }
  res.json({ key: `${hid}|${date}`, value: CELL_VALUES.includes(value) ? value : null });
}));

router.put('/periods/:id/mood', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const { date, value } = req.body;
  if (!isDayOf(m.month, date)) return res.status(400).json({ error: 'Date invalide' });
  if ([1, 2, 3].includes(value)) {
    await pool.query(
      `INSERT INTO moods (month_id, day, value) VALUES ($1, $2, $3)
       ON CONFLICT (month_id, day) DO UPDATE SET value = EXCLUDED.value`,
      [m.id, date, value],
    );
  } else {
    await pool.query('DELETE FROM moods WHERE month_id = $1 AND day = $2', [m.id, date]);
  }
  res.json({ date, value: [1, 2, 3].includes(value) ? value : null });
}));

router.put('/periods/:id/weight', wrap(async (req, res) => {
  const m = await ownMonth(req, res);
  if (!m) return;
  const { date, value } = req.body;
  if (!isDayOf(m.month, date)) return res.status(400).json({ error: 'Date invalide' });
  const kg = Number(value);
  if (value !== null && value !== '' && kg > 0 && kg < 500) {
    const rounded = Math.round(kg * 10) / 10;
    await pool.query(
      `INSERT INTO weights (month_id, day, kg) VALUES ($1, $2, $3)
       ON CONFLICT (month_id, day) DO UPDATE SET kg = EXCLUDED.kg`,
      [m.id, date, rounded],
    );
    return res.json({ date, value: rounded });
  }
  await pool.query('DELETE FROM weights WHERE month_id = $1 AND day = $2', [m.id, date]);
  res.json({ date, value: null });
}));

// ---------- Import d'un ancien fichier JSON ----------

router.post('/import', wrap(async (req, res) => {
  const periods = req.body && req.body.periods;
  if (!Array.isArray(periods)) return res.status(400).json({ error: 'Fichier invalide : il doit contenir "periods"' });
  res.json(await importForUser(req.session.userId, periods));
}));

module.exports = router;
