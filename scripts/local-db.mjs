// PostgreSQL local pour le développement uniquement (en ligne, c'est Neon)
// Lancer : npm run db   (laisser ce terminal ouvert, Ctrl + C pour arrêter)
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', '.pgdata');
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'habit', password: 'habit', port: 5433, persistent: true });

const firstTime = !fs.existsSync(dir);
if (firstTime) await pg.initialise();
await pg.start();
if (firstTime) await pg.createDatabase('habit_tracker');
console.log('PostgreSQL local prêt : postgres://habit:habit@localhost:5433/habit_tracker');

process.on('SIGINT', async () => {
  await pg.stop();
  process.exit(0);
});
