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

/**
 * Escopo das migrações: sem escopo = core. Com escopo (plugin), o nome gravado é `<scope>/<nome>`
 * e, com `schema`, cada migração roda com `search_path` = schema, public (o schema é criado).
 */
export interface MigrationScope {
  scope?: string;
  schema?: string;
}

const stored = (opts: MigrationScope, name: string) =>
  opts.scope ? `${opts.scope}/${name}` : name;

export async function appliedMigrations(sql: Sql, opts: MigrationScope = {}): Promise<string[]> {
  await ensureTable(sql);
  const rows = opts.scope
    ? await sql<{ name: string }[]>`
        select substr(name, ${opts.scope.length + 2}) as name from schema_migrations
        where starts_with(name, ${`${opts.scope}/`}) order by name`
    : await sql<{ name: string }[]>`
        select name from schema_migrations where strpos(name, '/') = 0 order by name`;
  return rows.map((r) => r.name);
}

async function useScope(tx: Sql, opts: MigrationScope): Promise<void> {
  if (!opts.schema) return;
  const schema = tx(opts.schema);
  await tx`create schema if not exists ${schema}`;
  await tx`select set_config('search_path', ${`"${opts.schema}", public`}, true)`;
}

/** Aplica as migrações pendentes, cada uma em transação. Retorna os nomes aplicados. */
export async function migrateUp(
  sql: Sql,
  migrations: Migration[],
  opts: MigrationScope = {},
): Promise<string[]> {
  const done = new Set(await appliedMigrations(sql, opts));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await useScope(tx, opts);
      await tx.unsafe(m.up);
      await tx`insert into public.schema_migrations (name) values (${stored(opts, m.name)})`;
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
  opts: MigrationScope = {},
): Promise<string[]> {
  const done = await appliedMigrations(sql, opts);
  const toRevert = done.reverse().slice(0, steps === 'all' ? undefined : steps);
  const reverted: string[] = [];
  for (const name of toRevert) {
    const m = migrations.find((x) => x.name === name);
    if (!m) throw new Error(`Migração aplicada ${name} não existe no diretório`);
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await useScope(tx, opts);
      await tx.unsafe(m.down);
      await tx`delete from public.schema_migrations where name = ${stored(opts, name)}`;
    });
    reverted.push(name);
  }
  return reverted;
}
