import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createPreferencesRouter, listPreferences } from './index.js';

const migrationsDir = path.resolve(import.meta.dirname, '../../migrations');

describe.skipIf(!process.env['TEST_DATABASE_URL'])('preferences (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;

  const app = () => buildTestApp(sql, (a) => a.route('/', createPreferencesRouter({ db: sql })));

  const call = (
    method: string,
    p: string,
    user: TestUser | null,
    body?: unknown,
  ): Promise<Response> =>
    app().request(p, {
      method,
      headers: {
        ...(user ? { cookie: user.cookie } : {}),
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`truncate user_preferences, sessions, users cascade`;
    manager = await loginAs(sql, { email: 'gestor@x.com', role: 'manager' });
    ana = await loginAs(sql, { email: 'ana@x.com' });
    bia = await loginAs(sql, { email: 'bia@x.com' });
  });

  it('devolve o padrão vazio quando não há preferências', async () => {
    const res = await call('GET', '/me/preferences', ana);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      preferences: { userId: ana.id, avoidWeekdays: [], maxConsecutiveShifts: null },
    });
  });

  it('grava, atualiza e lê as próprias preferências', async () => {
    const put = await call('PUT', '/me/preferences', ana, {
      avoidWeekdays: [6, 0],
      maxConsecutiveShifts: 3,
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      preferences: { userId: ana.id, avoidWeekdays: [0, 6], maxConsecutiveShifts: 3 },
    });

    const again = await call('PUT', '/me/preferences', ana, {
      avoidWeekdays: [],
      maxConsecutiveShifts: null,
    });
    expect(again.status).toBe(200);
    const get = await (await call('GET', '/me/preferences', ana)).json();
    expect(get.preferences).toEqual({
      userId: ana.id,
      avoidWeekdays: [],
      maxConsecutiveShifts: null,
    });
    const rows = await sql`select 1 from user_preferences where user_id = ${ana.id}`;
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['dia fora de 0-6', { avoidWeekdays: [7], maxConsecutiveShifts: null }],
    ['dia negativo', { avoidWeekdays: [-1], maxConsecutiveShifts: null }],
    ['dia fracionário', { avoidWeekdays: [1.5], maxConsecutiveShifts: null }],
    ['dia repetido', { avoidWeekdays: [1, 1], maxConsecutiveShifts: null }],
    ['máximo zero', { avoidWeekdays: [], maxConsecutiveShifts: 0 }],
    ['máximo acima de 14', { avoidWeekdays: [], maxConsecutiveShifts: 15 }],
    ['máximo fracionário', { avoidWeekdays: [], maxConsecutiveShifts: 2.5 }],
    ['sem avoidWeekdays', { maxConsecutiveShifts: 2 }],
    ['campo extra', { avoidWeekdays: [], maxConsecutiveShifts: null, x: 1 }],
  ])('rejeita %s com 400', async (_name, body) => {
    const res = await call('PUT', '/me/preferences', ana, body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('validation_error');
    expect(typeof json.message).toBe('string');
    expect(await sql`select 1 from user_preferences`).toHaveLength(0);
  });

  it('rejeita corpo inválido e exige autenticação', async () => {
    expect((await call('PUT', '/me/preferences', ana, 'x')).status).toBe(400);
    expect((await call('GET', '/me/preferences', null)).status).toBe(401);
    expect(
      (await call('PUT', '/me/preferences', null, { avoidWeekdays: [], maxConsecutiveShifts: 1 }))
        .status,
    ).toBe(401);
    expect((await call('GET', `/users/${ana.id}/preferences`, null)).status).toBe(401);
  });

  it('isola membros: cada um só vê e altera as próprias preferências', async () => {
    await call('PUT', '/me/preferences', ana, { avoidWeekdays: [2], maxConsecutiveShifts: 2 });
    const bias = await (await call('GET', '/me/preferences', bia)).json();
    expect(bias.preferences).toEqual({
      userId: bia.id,
      avoidWeekdays: [],
      maxConsecutiveShifts: null,
    });

    const other = await call('GET', `/users/${ana.id}/preferences`, bia);
    expect(other.status).toBe(403);
    expect((await call('GET', `/users/${bia.id}/preferences`, bia)).status).toBe(403);
  });

  it('gestor lê as preferências de outro membro', async () => {
    await call('PUT', '/me/preferences', ana, { avoidWeekdays: [5, 6], maxConsecutiveShifts: 4 });
    const res = await call('GET', `/users/${ana.id}/preferences`, manager);
    expect(res.status).toBe(200);
    expect((await res.json()).preferences).toEqual({
      userId: ana.id,
      avoidWeekdays: [5, 6],
      maxConsecutiveShifts: 4,
    });
    const empty = await (await call('GET', `/users/${bia.id}/preferences`, manager)).json();
    expect(empty.preferences.avoidWeekdays).toEqual([]);
    expect(
      (await call('GET', '/users/00000000-0000-4000-8000-000000000000/preferences', manager))
        .status,
    ).toBe(404);
    expect((await call('GET', '/users/abc/preferences', manager)).status).toBe(404);
  });

  it('audita a alteração na mesma transação com before e after', async () => {
    await call('PUT', '/me/preferences', ana, { avoidWeekdays: [0], maxConsecutiveShifts: null });
    await call('PUT', '/me/preferences', ana, { avoidWeekdays: [0, 3], maxConsecutiveShifts: 5 });
    const rows = await sql<
      { actor_id: string; action: string; entity_id: string; before: unknown; after: unknown }[]
    >`select actor_id, action, entity_id, before, after from audit_log
      where entity_type = 'preferences' and entity_id = ${ana.id} order by occurred_at, id`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actor_id: ana.id,
      action: 'preferences.update',
      entity_id: ana.id,
      before: { avoidWeekdays: [], maxConsecutiveShifts: null },
      after: { avoidWeekdays: [0], maxConsecutiveShifts: null },
    });
    expect(rows[1]).toMatchObject({
      before: { avoidWeekdays: [0], maxConsecutiveShifts: null },
      after: { avoidWeekdays: [0, 3], maxConsecutiveShifts: 5 },
    });
  });

  it('listPreferences aplica o padrão vazio a quem não tem linha', async () => {
    await call('PUT', '/me/preferences', ana, { avoidWeekdays: [6], maxConsecutiveShifts: 2 });
    const map = await listPreferences(sql, [ana.id, bia.id]);
    expect([...map.keys()].sort()).toEqual([ana.id, bia.id].sort());
    expect(map.get(ana.id)).toEqual({ avoidWeekdays: [6], maxConsecutiveShifts: 2 });
    expect(map.get(bia.id)).toEqual({ avoidWeekdays: [], maxConsecutiveShifts: null });

    const onlyStored = await listPreferences(sql);
    expect([...onlyStored.keys()]).toEqual([ana.id]);
    expect((await listPreferences(sql, [])).size).toBe(0);
  });

  it('apaga as preferências em cascata ao remover o usuário', async () => {
    await call('PUT', '/me/preferences', ana, { avoidWeekdays: [1], maxConsecutiveShifts: 2 });
    await sql`delete from sessions where user_id = ${ana.id}`;
    await sql`delete from users where id = ${ana.id}`;
    expect(await sql`select 1 from user_preferences`).toHaveLength(0);
  });

  it('o banco recusa dias inválidos e máximo fora do intervalo', async () => {
    const insert = (days: string, max: number | null) =>
      sql.unsafe(
        `insert into user_preferences (user_id, avoid_weekdays, max_consecutive_shifts)
         values ('${ana.id}', '${days}', ${max})`,
      );
    await expect(insert('{7}', null)).rejects.toThrow();
    await expect(insert('{1,1}', null)).rejects.toThrow();
    await expect(insert('{}', 0)).rejects.toThrow();
    await expect(insert('{}', 15)).rejects.toThrow();
    await expect(insert('{0,6}', 14)).resolves.toBeDefined();
  });

  it('migração 0008 sobe e desce', async () => {
    const down = await readFile(path.join(migrationsDir, '0008_preferences.down.sql'), 'utf8');
    const up = await readFile(path.join(migrationsDir, '0008_preferences.up.sql'), 'utf8');
    await sql.unsafe(down);
    const gone = await sql`select to_regclass('user_preferences') as t`;
    expect(gone[0]?.['t']).toBeNull();
    await sql.unsafe(up);
    const back = await sql`select to_regclass('user_preferences') as t`;
    expect(back[0]?.['t']).toBe('user_preferences');
  });
});
