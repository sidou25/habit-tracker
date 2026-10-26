// Importe l'ancien fichier data/db.json dans le compte d'un utilisateur PostgreSQL
// Utilisation : npm run import-json -- <nom_utilisateur> [fichier.json]
// (le plus simple reste le bouton « Importer » du site, dans « Modifier le mois »)
const fs = require('fs');
const path = require('path');
const { pool, init } = require('../db');
const { importForUser } = require('../importer');

async function main() {
  const [username, file = path.join(__dirname, '..', 'data', 'db.json')] = process.argv.slice(2);
  if (!username) throw new Error('Usage : npm run import-json -- <nom_utilisateur> [fichier.json]');

  await init();
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
  if (!rows[0]) throw new Error(`Utilisateur "${username}" introuvable : crée d'abord le compte sur le site`);

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of await importForUser(rows[0].id, data.periods)) {
    console.log(`${r.month} : ${r.status}${r.checks !== undefined ? ` (${r.checks} cases)` : ''}`);
  }
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
