import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sql } from './db.js';

export interface Migration {
  name: string;
  up: string;
  down: string;
}

const FILE = /^(\d{4}_[a-z0-9_]+)\.(up|down)\.sql$/;

/** Lê as migrações do diretório, ordenadas pelo prefixo numérico; exige par up/down. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = await readdir(dir);
  const byName = new Map<string, { up?: string; down?: string }>();
  for (const f of files) {
    const m = FILE.exec(f);
    if (!m) continue;
    const entry = byName.get(m[1]!) ?? {};
    entry[m[2] as 'up' | 'down'] = await readFile(path.join(dir, f), 'utf8');
    byName.set(m[1]!, entry);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { up, down }]) => {
      if (up === undefined || down === undefined) {
        throw new Error(`Migração ${name} precisa dos arquivos .up.sql e .down.sql`);
      }
      return { name, up, down };
    });
}

async function ensureTable(sql: Sql): Promise<void> {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
}

export async function appliedMigrations(sql: Sql): Promise<string[]> {
  await ensureTable(sql);
  const rows = await sql<{ name: string }[]>`select name from schema_migrations order by name`;
  return rows.map((r) => r.name);
}

/** Aplica as migrações pendentes, cada uma em transação. Retorna os nomes aplicados. */
export async function migrateUp(sql: Sql, migrations: Migration[]): Promise<string[]> {
  const done = new Set(await appliedMigrations(sql));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.up);
      await tx`insert into schema_migrations (name) values (${m.name})`;
    });
    applied.push(m.name);
  }
  return applied;
}

/** Reverte as últimas `steps` migrações aplicadas (ou todas). Retorna os nomes revertidos. */
export async function migrateDown(
  sql: Sql,
  migrations: Migration[],
  steps: number | 'all' = 1,
): Promise<string[]> {
  const done = await appliedMigrations(sql);
  const toRevert = done.reverse().slice(0, steps === 'all' ? undefined : steps);
  const reverted: string[] = [];
  for (const name of toRevert) {
    const m = migrations.find((x) => x.name === name);
    if (!m) throw new Error(`Migração aplicada ${name} não existe no diretório`);
    await sql.begin(async (tx) => {
      await tx.unsafe(m.down);
      await tx`delete from schema_migrations where name = ${name}`;
    });
    reverted.push(name);
  }
  return reverted;
}
