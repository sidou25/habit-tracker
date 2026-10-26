// Connexion à PostgreSQL (adresse dans la variable DATABASE_URL)
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquant : crée un fichier .env (voir .env.example)');
  process.exit(1);
}

// garder les dates SQL (type DATE) en texte "YYYY-MM-DD", sans fuseau horaire
types.setTypeParser(1082, v => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// crée les tables si elles n'existent pas encore
async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
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
