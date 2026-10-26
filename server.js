// Serveur du Habit Tracker : API REST + fichiers statiques + comptes utilisateurs
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool, init } = require('./db');
const auth = require('./routes/auth');
const months = require('./routes/months');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET manquant');
  process.exit(1);
}

app.set('trust proxy', 1); // Render passe par un proxy HTTPS
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100kb' }));

// la session (qui est connecté) est gardée dans PostgreSQL, table "session"
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'dev-seulement',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,               // inaccessible au JavaScript de la page
    sameSite: 'lax',              // pas envoyé par les autres sites (protection CSRF)
    secure: isProd,               // HTTPS uniquement en ligne
    maxAge: 30 * 24 * 3600 * 1000, // 30 jours
  },
}));

app.use('/api/auth', auth.router);
app.use('/api', months);
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

init()
  .then(() => app.listen(PORT, () => console.log(`Habit Tracker lancé sur http://localhost:${PORT}`)))
  .catch(err => {
    console.error('Impossible de joindre PostgreSQL :', err.message);
    process.exit(1);
  });
