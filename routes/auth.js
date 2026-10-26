// Comptes : inscription, connexion, déconnexion (session stockée dans PostgreSQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { pool } = require('../db');

const router = express.Router();

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
// hash factice : on compare quand même si le compte n'existe pas (même temps de réponse)
const DUMMY_HASH = bcrypt.hashSync('pas-un-vrai-mot-de-passe', 12);

// max 20 tentatives / 15 min par adresse IP (contre les essais de mots de passe en boucle)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessaie dans 15 minutes' },
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// administrateurs : noms listés dans ADMIN_USERNAMES (ex : "sidou" ou "sidou,amine") ;
// si la variable est vide, c'est le premier compte créé sur le site
async function computeIsAdmin(user) {
  const admins = (process.env.ADMIN_USERNAMES || '').split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  if (admins.length) return admins.includes(user.username);
  const { rows } = await pool.query('SELECT min(id) AS first FROM users');
  return rows[0].first === user.id;
}

// nouvelle session après connexion (évite la fixation de session)
async function startSession(req, user) {
  const isAdmin = await computeIsAdmin(user);
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = isAdmin;
      req.session.save(err2 => (err2 ? reject(err2) : resolve()));
    });
  });
}

function readCredentials(req) {
  return {
    username: String(req.body.username || '').trim().toLowerCase(),
    password: String(req.body.password || ''),
  };
}

router.post('/register', limiter, wrap(async (req, res) => {
  const { username, password } = readCredentials(req);
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Nom : 3 à 30 caractères (lettres, chiffres, . _ -)' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Mot de passe : au moins 8 caractères' });
  }
  const hash = await bcrypt.hash(password, 12);
  let user;
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, last_login) VALUES ($1, $2, now()) RETURNING id, username',
      [username, hash],
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce nom est déjà pris' }); // UNIQUE
    throw err;
  }
  await startSession(req, user);
  res.status(201).json(whoAmI(req));
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const { username, password } = readCredentials(req);
  const { rows } = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
  await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
  await startSession(req, user);
  res.json(whoAmI(req));
}));

router.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.status(204).end();
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  res.json(whoAmI(req));
});

function whoAmI(req) {
  return { username: req.session.username, isAdmin: Boolean(req.session.isAdmin) };
}

// à placer devant les routes réservées aux utilisateurs connectés
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connecte-toi d\'abord' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connecte-toi d\'abord' });
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  next();
}

module.exports = { router, requireAuth, requireAdmin, wrap };
