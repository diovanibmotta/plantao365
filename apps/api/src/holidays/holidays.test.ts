import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { loadMigrations, migrateDown, migrateUp } from '../migrator.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createHolidaysRouter } from './router.js';
import { listHolidayDates, type ImpactChecker } from './service.js';

const migrationsDir = path.resolve(import.meta.dirname, '../../migrations');

describe.skipIf(!process.env['TEST_DATABASE_URL'])('holidays (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let member: TestUser;
  let impacts: Array<{ date: string; count: number }>;
  let checked: string[][];

  const checker: ImpactChecker = async (_sql, dates) => {
    checked.push(dates);
    return impacts.filter((i) => dates.includes(i.date));
  };

  const app = () =>
    buildTestApp(sql, (a) =>
      a.route('/', createHolidaysRouter({ db: sql, impactChecker: checker })),
    );

  const call = (
    method: string,
    url: string,
    user: TestUser | null,
    body?: unknown,
  ): Response | Promise<Response> =>
    app().request(url, {
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
    manager = await loginAs(sql, { email: 'gestor@example.com', role: 'manager' });
    member = await loginAs(sql, { email: 'membro@example.com', role: 'member' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    impacts = [];
    checked = [];
    await sql`delete from holidays where scope <> 'national' or date not between '2026-01-01' and '2027-12-31'`;
    await sql`delete from holidays where name like 'Teste%'`;
  });

  it('seeds 10 national holidays for 2026 and 2027 without timezone shift', async () => {
    const res = await call('GET', '/holidays?year=2026', member);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ date: string; scope: string }> };
    expect(body.items).toHaveLength(10);
    expect(body.items.every((h) => h.scope === 'national')).toBe(true);
    expect(body.items.map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-21',
      '2026-05-01',
      '2026-09-07',
      '2026-10-12',
      '2026-11-02',
      '2026-11-15',
      '2026-11-20',
      '2026-12-25',
    ]);
    const b2027 = (await (await call('GET', '/holidays?year=2027', member)).json()) as {
      items: Array<{ date: string }>;
    };
    expect(b2027.items).toHaveLength(10);
    expect(b2027.items[1]!.date).toBe('2027-03-26');
    const names = (await sql<{ name: string }[]>`select name from holidays`).map((r) => r.name);
    expect(names).not.toContain('Carnaval');
    expect(names).not.toContain('Corpus Christi');
  });

  it('creates, updates and removes a holiday with audit', async () => {
    const created = await call('POST', '/holidays', manager, {
      date: '2026-06-24',
      name: 'Teste São João',
      scope: 'state',
    });
    expect(created.status).toBe(201);
    const c = (await created.json()) as { id: string; date: string; warnings: unknown[] };
    expect(c).toMatchObject({ date: '2026-06-24', name: 'Teste São João', scope: 'state' });
    expect(c.warnings).toEqual([]);

    const updated = await call('PATCH', `/holidays/${c.id}`, manager, { name: 'Teste Junino' });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: c.id, name: 'Teste Junino', scope: 'state' });

    const removed = await call('DELETE', `/holidays/${c.id}`, manager);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ id: c.id, date: '2026-06-24' });
    expect((await call('DELETE', `/holidays/${c.id}`, manager)).status).toBe(404);
    expect((await call('PATCH', `/holidays/${c.id}`, manager, { name: 'x' })).status).toBe(404);

    const audit = await sql<
      { action: string; before: unknown; after: unknown; actor_id: string }[]
    >`select action, before, after, actor_id from audit_log
      where entity_type = 'holiday' and entity_id = ${c.id} order by id`;
    expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
    expect(audit[0]!.before).toBeNull();
    expect(audit[0]!.after).toMatchObject({ name: 'Teste São João' });
    expect(audit[1]!.before).toMatchObject({ name: 'Teste São João' });
    expect(audit[1]!.after).toMatchObject({ name: 'Teste Junino' });
    expect(audit[2]!.after).toBeNull();
    expect(audit.every((a) => a.actor_id === manager.id)).toBe(true);
  });

  it('rejects duplicate date+scope with 409 but allows other scope', async () => {
    const dup = await call('POST', '/holidays', manager, {
      date: '2026-12-25',
      name: 'Teste Natal',
      scope: 'national',
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: 'duplicate_holiday' });
    const ok = await call('POST', '/holidays', manager, {
      date: '2026-12-25',
      name: 'Teste Natal municipal',
      scope: 'municipal',
    });
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    const clash = await call('PATCH', `/holidays/${id}`, manager, { scope: 'national' });
    expect(clash.status).toBe(409);
    const audit = await sql`select 1 from audit_log where entity_id = ${id} and action = 'update'`;
    expect(audit).toHaveLength(0);
  });

  it('enforces authentication and roles', async () => {
    expect((await call('GET', '/holidays', null)).status).toBe(401);
    expect((await call('GET', '/holidays', member)).status).toBe(200);
    const payload = { date: '2026-06-24', name: 'Teste', scope: 'state' };
    expect((await call('POST', '/holidays', null, payload)).status).toBe(401);
    expect((await call('POST', '/holidays', member, payload)).status).toBe(403);
    const [h] = await sql<{ id: string }[]>`select id from holidays limit 1`;
    expect((await call('PATCH', `/holidays/${h!.id}`, member, { name: 'x' })).status).toBe(403);
    expect((await call('DELETE', `/holidays/${h!.id}`, member)).status).toBe(403);
    expect((await call('DELETE', `/holidays/${h!.id}`, null)).status).toBe(401);
  });

  it('validates input with 400', async () => {
    const bad: unknown[] = [
      { date: '2026-02-30', name: 'Teste', scope: 'state' },
      { date: '26-01-01', name: 'Teste', scope: 'state' },
      { date: '2026-06-24', name: '   ', scope: 'state' },
      { date: '2026-06-24', name: 'x'.repeat(101), scope: 'state' },
      { date: '2026-06-24', name: 'Teste', scope: 'federal' },
      {},
    ];
    for (const b of bad) {
      const res = await call('POST', '/holidays', manager, b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('validation_error');
    }
    const [h] = await sql<{ id: string }[]>`select id from holidays limit 1`;
    expect((await call('PATCH', `/holidays/${h!.id}`, manager, {})).status).toBe(400);
    expect(
      (await call('PATCH', `/holidays/${h!.id}`, manager, { date: '2026-13-01' })).status,
    ).toBe(400);
    expect((await call('GET', '/holidays?from=2026-12-01&to=2026-01-01', member)).status).toBe(400);
    expect((await call('GET', '/holidays?year=abc', member)).status).toBe(400);
  });

  it('adds warnings for published shifts on create, update (old and new date) and delete', async () => {
    impacts = [
      { date: '2026-06-24', count: 2 },
      { date: '2026-06-25', count: 1 },
      { date: '2026-06-26', count: 0 },
    ];
    const created = await call('POST', '/holidays', manager, {
      date: '2026-06-24',
      name: 'Teste',
      scope: 'state',
    });
    const c = (await created.json()) as { id: string; warnings: unknown[] };
    expect(c.warnings).toEqual([
      { type: 'published_shifts_affected', date: '2026-06-24', count: 2 },
    ]);

    const moved = await call('PATCH', `/holidays/${c.id}`, manager, { date: '2026-06-25' });
    expect(((await moved.json()) as { warnings: unknown[] }).warnings).toEqual([
      { type: 'published_shifts_affected', date: '2026-06-24', count: 2 },
      { type: 'published_shifts_affected', date: '2026-06-25', count: 1 },
    ]);
    expect(checked.at(-1)).toEqual(['2026-06-24', '2026-06-25']);

    const renamed = await call('PATCH', `/holidays/${c.id}`, manager, { name: 'Teste 2' });
    expect(((await renamed.json()) as { warnings: unknown[] }).warnings).toEqual([
      { type: 'published_shifts_affected', date: '2026-06-25', count: 1 },
    ]);

    const removed = await call('DELETE', `/holidays/${c.id}`, manager);
    expect(((await removed.json()) as { warnings: unknown[] }).warnings).toEqual([
      { type: 'published_shifts_affected', date: '2026-06-25', count: 1 },
    ]);
  });

  it('defaults impact checker to no warnings', async () => {
    const plain = buildTestApp(sql, (a) => a.route('/', createHolidaysRouter({ db: sql })));
    const res = await plain.request('/holidays', {
      method: 'POST',
      headers: {
        cookie: manager.cookie,
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ date: '2026-07-09', name: 'Teste Default', scope: 'state' }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { warnings: unknown[] }).warnings).toEqual([]);
  });

  it('filters by year, from and to, ordered by date', async () => {
    const r = await call('GET', '/holidays?from=2026-04-01&to=2026-05-31', member);
    const body = (await r.json()) as { items: Array<{ date: string }> };
    expect(body.items.map((h) => h.date)).toEqual(['2026-04-03', '2026-04-21', '2026-05-01']);
    const all = (await (await call('GET', '/holidays', member)).json()) as {
      items: Array<{ date: string }>;
    };
    const dates = all.items.map((h) => h.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates.length).toBeGreaterThanOrEqual(20);
  });

  it('listHolidayDates returns distinct sorted date strings', async () => {
    await call('POST', '/holidays', manager, {
      date: '2026-04-21',
      name: 'Teste Tiradentes municipal',
      scope: 'municipal',
    });
    expect(await listHolidayDates(sql, '2026-04-01', '2026-05-01')).toEqual([
      '2026-04-03',
      '2026-04-21',
      '2026-05-01',
    ]);
    expect(await listHolidayDates(sql, '2026-02-01', '2026-02-28')).toEqual([]);
  });
});

describe.skipIf(!process.env['TEST_DATABASE_URL'])('holidays migration (PostgreSQL)', () => {
  it('applies up, reverts down and reapplies', async () => {
    const t = await createTestDb({ migrate: false });
    try {
      const all = await loadMigrations(migrationsDir);
      const upto = all.filter((m) => m.name <= '0005_holidays');
      await migrateUp(t.sql, upto);
      const [{ n }] = await t.sql<{ n: number }[]>`select count(*)::int as n from holidays`;
      expect(n).toBe(20);
      expect(await migrateDown(t.sql, upto, 1)).toEqual(['0005_holidays']);
      const [{ reg }] = await t.sql<
        { reg: string | null }[]
      >`select to_regclass('holidays') as reg`;
      expect(reg).toBeNull();
      await migrateUp(t.sql, upto);
      const [{ n: again }] = await t.sql<{ n: number }[]>`select count(*)::int as n from holidays`;
      expect(again).toBe(20);
    } finally {
      await t.drop();
    }
  });
});
