// Comptes : inscription, connexion, déconnexion (session stockée dans PostgreSQL), droit admin
const crypto = require('crypto');
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

// le code admin est court : seulement 5 essais / 15 min par adresse IP
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true, // seuls les mauvais codes comptent
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop d\'essais, réessaie dans 15 minutes' },
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// est admin : un compte qui a donné le code admin, un nom listé dans ADMIN_USERNAMES,
// ou (si ADMIN_USERNAMES est vide) le premier compte créé. Vérifié à chaque requête.
async function isAdminUser(userId, username) {
  const admins = (process.env.ADMIN_USERNAMES || '').split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(username)) return true;
  const { rows } = await pool.query(
    'SELECT is_admin, id = (SELECT min(id) FROM users) AS first FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return false;
  return rows[0].is_admin || (!admins.length && rows[0].first);
}

// nouvelle session après connexion (évite la fixation de session)
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save(err2 => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function whoAmI(req) {
  return { username: req.session.username, isAdmin: await isAdminUser(req.session.userId, req.session.username) };
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
  res.status(201).json(await whoAmI(req));
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const { username, password } = readCredentials(req);
  const { rows } = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
  await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
  await startSession(req, user);
  res.json(await whoAmI(req));
}));

router.post('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.status(204).end();
  });
});

router.get('/me', wrap(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  res.json(await whoAmI(req));
}));

// code admin (variable ADMIN_CODE, jamais écrite dans le code) : le compte connecté devient admin
router.post('/admin-code', codeLimiter, wrap(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Connecte-toi d\'abord' });
  const expected = String(process.env.ADMIN_CODE || '');
  if (!expected) return res.status(503).json({ error: 'Code admin non configuré sur le serveur' });
  // comparaison à temps constant (sur les empreintes, pour avoir la même longueur)
  const hash = s => crypto.createHash('sha256').update(s).digest();
  if (!crypto.timingSafeEqual(hash(String(req.body.code || '').trim()), hash(expected))) {
    return res.status(403).json({ error: 'Code incorrect' });
  }
  await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [req.session.userId]);
  res.json({ isAdmin: true });
}));

// à placer devant les routes réservées aux utilisateurs connectés
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connecte-toi d\'abord' });
  next();
}

const requireAdmin = wrap(async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Connecte-toi d\'abord' });
  if (!(await isAdminUser(req.session.userId, req.session.username))) {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  next();
});

module.exports = { router, requireAuth, requireAdmin, wrap };
