// Page admin : comptes et activité. Seulement des chiffres, jamais les notes, l'humeur ou le poids.
const express = require('express');
const { pool } = require('../db');
const { requireAdmin, wrap } = require('./auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.created_at, u.last_login, u.is_admin,
      (SELECT count(*) FROM months m WHERE m.user_id = u.id)::int AS months,
      (SELECT count(*) FROM moods mo JOIN months m ON m.id = mo.month_id WHERE m.user_id = u.id)::int AS moods,
      COALESCE(s.done, 0)::int AS done,
      COALESCE(s.miss, 0)::int AS miss,
      s.last_day
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE c.value = 'done') AS done,
             count(*) FILTER (WHERE c.value = 'miss') AS miss,
             max(c.day) AS last_day
      FROM months m
      JOIN habits h ON h.month_id = m.id
      JOIN checks c ON c.habit_id = h.id
      WHERE m.user_id = u.id
    ) s ON true
    ORDER BY u.created_at DESC`);
  res.json({ me: req.session.userId, users: rows });
}));

// supprimer un compte et toutes ses données (ex : compte de spam)
router.delete('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Compte introuvable' });
  if (id === req.session.userId) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte ici' });
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]); // CASCADE : mois, habitudes…
  if (!rowCount) return res.status(404).json({ error: 'Compte introuvable' });
  // déconnecter ce compte partout
  await pool.query(`DELETE FROM "session" WHERE (sess->>'userId')::int = $1`, [id]);
  res.status(204).end();
}));

module.exports = router;
