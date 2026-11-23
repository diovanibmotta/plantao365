import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { appliedMigrations, loadMigrations, migrateDown, migrateUp } from './migrator.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main(): Promise<void> {
  const [command = 'status', arg] = process.argv.slice(2);
  const config = loadConfig();
  const sql = createDb(config.DATABASE_URL, { max: 1 });
  try {
    const migrations = await loadMigrations(dir);
    if (command === 'up') {
      const applied = await migrateUp(sql, migrations);
      console.log(applied.length ? `aplicadas: ${applied.join(', ')}` : 'nada a aplicar');
    } else if (command === 'down') {
      const steps = arg === 'all' ? 'all' : Number(arg ?? 1);
      const reverted = await migrateDown(sql, migrations, steps);
      console.log(reverted.length ? `revertidas: ${reverted.join(', ')}` : 'nada a reverter');
    } else if (command === 'status') {
      const done = new Set(await appliedMigrations(sql));
      for (const m of migrations) console.log(`${done.has(m.name) ? '[x]' : '[ ]'} ${m.name}`);
    } else {
      console.error('uso: migrate <up|down [n|all]|status>');
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
