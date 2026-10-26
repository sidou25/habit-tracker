// Connexion à PostgreSQL (adresse dans la variable DATABASE_URL)
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// garder les dates SQL (type DATE) en texte "YYYY-MM-DD", sans fuseau horaire
types.setTypeParser(1082, v => v);

const onVercel = Boolean(process.env.VERCEL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: onVercel ? 3 : 10,                    // sur Vercel, chaque fonction garde peu de connexions
  idleTimeoutMillis: onVercel ? 5000 : 10000,
});
// une connexion coupée par le serveur (ex : Neon en veille) ne doit pas faire planter l'app
pool.on('error', err => console.error('PostgreSQL :', err.message));

// crée les tables si elles n'existent pas encore (une fois par démarrage, réessayé en cas d'échec)
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(sql);
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

// exécute fn(client) dans une transaction : tout réussit ou rien n'est gardé
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, transaction };
