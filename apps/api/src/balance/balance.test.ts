import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { loadMigrations, migrateDown, migrateUp } from '../migrator.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { computeBalance, createBalanceRouter, listActualHoursByUser } from './index.js';

const NOW = new Date('2026-06-15T12:00:00Z');

describe.skipIf(!process.env['TEST_DATABASE_URL'])('balance (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;

  const app = (now: Date = NOW) =>
    buildTestApp(sql, (a) => a.route('/', createBalanceRouter({ db: sql, now: () => now })));

  const call = (method: string, url: string, user: TestUser | null, body?: unknown) =>
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

  const addSchedule = async (status: 'draft' | 'published', start: string, end: string) => {
    const [s] = await sql<{ id: string }[]>`
      insert into schedules (start_date, end_date, status, created_by)
      values (${start}::date, ${end}::date, ${status}, ${manager.id}) returning id`;
    return s!.id;
  };

  const addShift = (
    scheduleId: string,
    date: string,
    hours: 14 | 24,
    userId: string | null,
    original: { userId: string; hours: number } | null,
  ) => {
    const startsAt = hours === 14 ? `${date}T21:00:00Z` : `${date}T11:00:00Z`;
    const endsAt = new Date(new Date(startsAt).getTime() + (hours === 14 ? 14 : 24) * 3600_000);
    return sql`
      insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id,
        original_user_id, original_hours)
      values (${scheduleId}, ${date}::date, ${hours === 14 ? 'weekday' : 'weekend'}, ${hours},
        ${startsAt}::timestamptz, ${endsAt.toISOString()}::timestamptz, ${userId},
        ${original?.userId ?? null}, ${original?.hours ?? null})`;
  };

  const seed = async () => {
    const pub = await addSchedule('published', '2026-05-01', '2026-06-30');
    await addShift(pub, '2026-05-29', 14, ana.id, { userId: ana.id, hours: 14 });
    await addShift(pub, '2026-05-30', 24, bia.id, { userId: ana.id, hours: 24 });
    await addShift(pub, '2026-05-31', 24, ana.id, { userId: ana.id, hours: 24 });
    await addShift(pub, '2026-06-01', 14, bia.id, null);
    await addShift(pub, '2026-06-20', 14, ana.id, { userId: ana.id, hours: 14 });
    const draft = await addSchedule('draft', '2026-07-01', '2026-07-31');
    await addShift(draft, '2026-07-01', 14, ana.id, { userId: ana.id, hours: 14 });
    await addShift(draft, '2026-05-02', 14, ana.id, { userId: ana.id, hours: 14 });
  };

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`truncate hour_adjustments, shifts, schedules, sessions, users cascade`;
    manager = await loginAs(sql, { email: 'gestor@x.com', role: 'manager', name: 'Gestor' });
    ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
    bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });
  });

  const monthOf = (months: Array<{ month: string }>, m: string) =>
    months.find((x) => x.month === m);

  it('previsto fica com o original e realizado com o vigente; futuro, rascunho e fallback', async () => {
    await seed();
    const ana1 = await (await call('GET', '/me/balance?year=2026', ana)).json();
    expect(monthOf(ana1.months, '2026-05')).toEqual({
      month: '2026-05',
      planned: 62,
      actual: 38,
      difference: -24,
    });
    expect(monthOf(ana1.months, '2026-06')).toEqual({
      month: '2026-06',
      planned: 14,
      actual: 0,
      difference: -14,
    });
    expect(monthOf(ana1.months, '2026-07')).toMatchObject({ planned: 0, actual: 0 });
    expect(ana1.total).toEqual({ planned: 76, actual: 38, difference: -38 });
    expect(ana1.months).toHaveLength(12);

    const bia1 = await (await call('GET', '/me/balance?year=2026', bia)).json();
    expect(monthOf(bia1.months, '2026-05')).toMatchObject({ planned: 0, actual: 24 });
    expect(monthOf(bia1.months, '2026-06')).toMatchObject({ planned: 14, actual: 14 });
  });

  it('detalhe por plantão com status e troca', async () => {
    await seed();
    const { shifts } = await (await call('GET', '/me/balance?year=2026', ana)).json();
    expect(shifts).toEqual([
      {
        date: '2026-05-29',
        dayType: 'weekday',
        plannedHours: 14,
        actualHours: 14,
        status: 'done',
        swapped: false,
      },
      {
        date: '2026-05-30',
        dayType: 'weekend',
        plannedHours: 24,
        actualHours: 0,
        status: 'done',
        swapped: true,
      },
      {
        date: '2026-05-31',
        dayType: 'weekend',
        plannedHours: 24,
        actualHours: 24,
        status: 'done',
        swapped: false,
      },
      {
        date: '2026-06-20',
        dayType: 'weekday',
        plannedHours: 14,
        actualHours: 0,
        status: 'upcoming',
        swapped: false,
      },
    ]);
  });

  it('plantão que cruza o mês conta no mês de início; em curso não conta', async () => {
    const pub = await addSchedule('published', '2026-05-31', '2026-06-15');
    await addShift(pub, '2026-05-31', 24, ana.id, { userId: ana.id, hours: 24 });
    await addShift(pub, '2026-06-15', 14, ana.id, { userId: ana.id, hours: 14 });
    const [b] = await computeBalance(sql, { userId: ana.id, year: 2026, now: NOW });
    expect(monthOf(b!.months, '2026-05')).toMatchObject({ planned: 24, actual: 24 });
    expect(monthOf(b!.months, '2026-06')).toMatchObject({ planned: 14, actual: 0 });
  });

  it('ajustes positivo e negativo entram no realizado; acumulado do ano', async () => {
    await seed();
    const a = await call('POST', '/balance/adjustments', manager, {
      userId: ana.id,
      date: '2026-05-10',
      hours: 2,
      reason: 'Acionamento extra',
    });
    expect(a.status).toBe(201);
    await call('POST', '/balance/adjustments', manager, {
      userId: ana.id,
      date: '2026-06-02',
      hours: -0.5,
      reason: 'Correção',
    });
    const body = await (await call('GET', '/me/balance?year=2026', ana)).json();
    expect(monthOf(body.months, '2026-05')).toMatchObject({ actual: 40, difference: -22 });
    expect(monthOf(body.months, '2026-06')).toMatchObject({ actual: -0.5, difference: -14.5 });
    expect(body.total).toEqual({ planned: 76, actual: 39.5, difference: -36.5 });
  });

  it('membro não vê saldo de outro; gestor vê usuário e comparativo', async () => {
    await seed();
    expect((await call('GET', `/users/${bia.id}/balance?year=2026`, ana)).status).toBe(403);
    expect((await call('GET', '/balance?year=2026', ana)).status).toBe(403);
    expect((await call('GET', '/balance/adjustments', ana)).status).toBe(403);
    expect((await call('GET', '/me/balance', null)).status).toBe(401);

    const one = await (await call('GET', `/users/${bia.id}/balance?year=2026`, manager)).json();
    expect(one.total).toEqual({ planned: 14, actual: 38, difference: 24 });
    expect((await call('GET', `/users/${crypto.randomUUID()}/balance`, manager)).status).toBe(404);

    const all = await (await call('GET', '/balance?year=2026', manager)).json();
    const names = all.members.map((m: { name: string }) => m.name);
    expect(names).toEqual(['Ana', 'Bia', 'Gestor']);
    const row = all.members.find((m: { name: string }) => m.name === 'Ana');
    expect(row).toMatchObject({ userId: ana.id, planned: 76, actual: 38, difference: -38 });
    expect(row.months).toHaveLength(12);
  });

  it('comparativo omite inativo sem rodízio e sem plantões', async () => {
    await loginAs(sql, { email: 'off@x.com', name: 'Off', active: false });
    await loginAs(sql, { email: 'sem@x.com', name: 'Sem', participatesInRotation: false });
    const all = await (await call('GET', '/balance?year=2026', manager)).json();
    expect(all.members.map((m: { name: string }) => m.name)).toEqual(['Ana', 'Bia', 'Gestor']);
  });

  it('valida ajustes (400) e usuário inexistente (404)', async () => {
    const ok = { userId: ana.id, date: '2026-05-10', hours: 1, reason: 'x' };
    const bad = [
      { ...ok, hours: 0 },
      { ...ok, hours: 49 },
      { ...ok, hours: -48.5 },
      { ...ok, hours: 1.25 },
      { ...ok, reason: '   ' },
      { ...ok, reason: 'a'.repeat(301) },
      { ...ok, date: '10/05/2026' },
      { ...ok, userId: 'nao-uuid' },
    ];
    for (const b of bad) {
      const res = await call('POST', '/balance/adjustments', manager, b);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation_error' });
    }
    expect((await call('GET', '/me/balance?year=abc', ana)).status).toBe(400);
    const missing = await call('POST', '/balance/adjustments', manager, {
      ...ok,
      userId: crypto.randomUUID(),
    });
    expect(missing.status).toBe(404);
    expect((await call('POST', '/balance/adjustments', ana, ok)).status).toBe(403);
  });

  it('usa o ano de America/Sao_Paulo como padrao (31/12 23:30 -03:00 e 2026)', async () => {
    const res = await app(new Date('2026-12-31T23:30:00-03:00')).request('/me/balance', {
      headers: { cookie: ana.cookie, ...csrfHeaders, origin: TEST_ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ year: 2026 });
  });

  it('lista, exclui e audita ajustes na mesma transação', async () => {
    const created = await (
      await call('POST', '/balance/adjustments', manager, {
        userId: ana.id,
        date: '2026-05-10',
        hours: 3.5,
        reason: 'Acionamento',
      })
    ).json();
    const list = await (
      await call('GET', `/balance/adjustments?userId=${ana.id}&year=2026`, manager)
    ).json();
    expect(list.items).toEqual([created.adjustment]);
    expect(created.adjustment).toMatchObject({ hours: 3.5, createdBy: manager.id });

    const one = await call('GET', `/balance/adjustments/${created.adjustment.id}`, manager);
    expect(one.status).toBe(200);
    expect((await one.json()).adjustment).toEqual(created.adjustment);
    expect((await call('GET', `/balance/adjustments/${created.adjustment.id}`, ana)).status).toBe(
      403,
    );
    expect(
      (await call('GET', '/balance/adjustments/00000000-0000-4000-8000-000000000000', manager))
        .status,
    ).toBe(404);
    expect((await call('GET', '/balance/adjustments/xx', manager)).status).toBe(404);

    expect(
      (await call('DELETE', `/balance/adjustments/${created.adjustment.id}`, ana)).status,
    ).toBe(403);
    expect(
      (await call('DELETE', `/balance/adjustments/${created.adjustment.id}`, manager)).status,
    ).toBe(204);
    expect(
      (await call('DELETE', `/balance/adjustments/${created.adjustment.id}`, manager)).status,
    ).toBe(404);

    const audit = await sql<{ action: string; entityType: string; actorId: string }[]>`
      select action, entity_type as "entityType", actor_id as "actorId"
      from audit_log where entity_type = 'adjustment' and entity_id = ${created.adjustment.id} order by occurred_at, id`;
    expect(audit.map((a) => a.action).sort()).toEqual(['adjustment.create', 'adjustment.delete']);
    expect(audit.every((a) => a.actorId === manager.id)).toBe(true);
  });

  it('exige o header CSRF em métodos não seguros', async () => {
    const res = await app().request('/balance/adjustments', {
      method: 'POST',
      headers: { cookie: manager.cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: ana.id, date: '2026-05-10', hours: 1, reason: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('listActualHoursByUser soma realizado encerrado e ajustes no intervalo', async () => {
    await seed();
    await sql`insert into hour_adjustments (user_id, date, hours, reason, created_by)
      values (${ana.id}, '2026-05-10', 2, 'x', ${manager.id})`;
    const map = await listActualHoursByUser(sql, {
      from: '2026-05-01',
      to: '2026-06-30',
      now: NOW,
    });
    expect(map.get(ana.id)).toBe(40);
    expect(map.get(bia.id)).toBe(38);
    const early = await listActualHoursByUser(sql, {
      from: '2026-05-01',
      to: '2026-05-29',
      now: new Date('2026-05-31T12:00:00Z'),
    });
    expect(early.get(ana.id)).toBe(16);
    expect(early.has(bia.id)).toBe(false);
  });

  it('migração 0009 sobe e desce', async () => {
    const m = await createTestDb({ migrate: false });
    try {
      const migrations = await loadMigrations(
        path.resolve(import.meta.dirname, '../../migrations'),
      );
      await migrateUp(m.sql, migrations);
      const exists = async () =>
        (
          await m.sql`select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'hour_adjustments'`
        ).length;
      expect(await exists()).toBe(1);
      // reverte a 0009 e todas as posteriores
      await migrateDown(m.sql, migrations, migrations.length - 8);
      expect(await exists()).toBe(0);
      await migrateUp(m.sql, migrations);
      expect(await exists()).toBe(1);
    } finally {
      await m.drop();
    }
  });
});
