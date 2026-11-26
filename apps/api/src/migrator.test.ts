import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from './db.js';
import { createTestDb, type TestDb } from './test-utils.js';
import { appliedMigrations, loadMigrations, migrateDown, migrateUp } from './migrator.js';

const migrationsDir = path.resolve(import.meta.dirname, '../migrations');

describe('loadMigrations', () => {
  it('loads the repository migrations in order with up and down', async () => {
    const list = await loadMigrations(migrationsDir);
    expect(list[0]?.name).toBe('0001_baseline');
    expect(list.every((m) => m.up.length > 0 && m.down.length > 0)).toBe(true);
    expect(list.map((m) => m.name)).toEqual([...list.map((m) => m.name)].sort());
  });

  it('rejects a migration without its down file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mig-'));
    try {
      await writeFile(path.join(dir, '0001_x.up.sql'), 'select 1;');
      await expect(loadMigrations(dir)).rejects.toThrow(/0001_x/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const testUrl = process.env['TEST_DATABASE_URL'];

describe.skipIf(!testUrl)('migrator against PostgreSQL (TEST_DATABASE_URL)', () => {
  let t: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    t = await createTestDb({ migrate: false });
    sql = t.sql;
  });

  afterAll(async () => {
    await t.drop();
  });

  it('applies, is idempotent and reverts', async () => {
    const migrations = await loadMigrations(migrationsDir);
    expect(await migrateUp(sql, migrations)).toEqual(migrations.map((m) => m.name));
    expect(await migrateUp(sql, migrations)).toEqual([]);
    expect(await appliedMigrations(sql)).toEqual(migrations.map((m) => m.name));
    expect(await migrateDown(sql, migrations, 'all')).toEqual(
      migrations.map((m) => m.name).reverse(),
    );
    expect(await appliedMigrations(sql)).toEqual([]);
  });

  it('isola migrações de plugin por escopo e schema', async () => {
    const core = await loadMigrations(migrationsDir);
    await migrateUp(sql, core);
    const plugin = [
      {
        name: '0001_init',
        up: 'create table notes (id serial primary key, body text);',
        down: 'drop table notes;',
      },
    ];
    const scope = { scope: 'plugin:demo', schema: 'plugin_demo' };

    expect(await migrateUp(sql, plugin, scope)).toEqual(['0001_init']);
    expect(await appliedMigrations(sql, scope)).toEqual(['0001_init']);
    // O core não enxerga as migrações do plugin (nem o down do core as reverte).
    expect(await appliedMigrations(sql)).toEqual(core.map((m) => m.name));
    await sql`insert into plugin_demo.notes (body) values ('ok')`;
    await expect(sql`select 1 from public.notes`).rejects.toThrow();

    expect(await migrateDown(sql, plugin, 'all', scope)).toEqual(['0001_init']);
    expect(await appliedMigrations(sql, scope)).toEqual([]);
    await migrateDown(sql, core, 'all');
  });
});
