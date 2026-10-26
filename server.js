// Serveur du Habit Tracker : API REST + fichiers statiques + comptes utilisateurs
// En local : node server.js. Sur Vercel : l'app exportée devient une fonction serverless.
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { pool, init } = require('./db');
const auth = require('./routes/auth');
const months = require('./routes/months');
const admin = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const onVercel = Boolean(process.env.VERCEL);

app.set('trust proxy', 1); // Vercel / Render passent par un proxy HTTPS

// en local, express.static sert public/ ; sur Vercel, c'est le CDN qui le sert
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err && !res.headersSent) res.redirect('/index.html');
  });
});

app.use(express.json({ limit: '100kb' }));

// avant toute route /api : configuration présente et base prête (sinon message clair, pas de crash)
app.use('/api', (req, res, next) => {
  if (isProd && !process.env.SESSION_SECRET) {
    return res.status(500).json({ error: 'SESSION_SECRET manquant dans les variables d\'environnement' });
  }
  init().then(() => next(), err => {
    console.error('Base de données :', err.message);
    res.status(503).json({
      error: process.env.DATABASE_URL ? 'Base de données injoignable' : 'DATABASE_URL manquant dans les variables d\'environnement',
    });
  });
});

// la session (qui est connecté) est gardée dans PostgreSQL, table "session"
app.use(session({
  store: new PgSession({ pool, pruneSessionInterval: onVercel ? false : 15 * 60 }),
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
app.use('/api/admin', admin);
app.use('/api', months);
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

// lancé directement (npm start) : on écoute un port ; importé (Vercel) : on exporte l'app
if (require.main === module) {
  app.listen(PORT, () => console.log(`Habit Tracker lancé sur http://localhost:${PORT}`));
  init().catch(err => console.error('Attention, PostgreSQL injoignable :', err.message));
}

module.exports = app;
