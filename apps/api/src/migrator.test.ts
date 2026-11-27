import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from './db.js';
import { createTestDb, type TestDb } from './test-utils.js';
import {
  appliedMigrations,
  loadMigrations,
  migrateDown,
  migrateUp,
  migrateUpLocked,
} from './migrator.js';

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

  it('applies pending migrations once when called concurrently under the lock', async () => {
    const migrations = await loadMigrations(migrationsDir);
    const results = await Promise.all([
      migrateUpLocked(sql, migrations),
      migrateUpLocked(sql, migrations),
    ]);
    expect(results.flat().sort()).toEqual(migrations.map((m) => m.name).sort());
    expect(await migrateUpLocked(sql, migrations)).toEqual([]);
    await migrateDown(sql, migrations, 'all');
  });
});
