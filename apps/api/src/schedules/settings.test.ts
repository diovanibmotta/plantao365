import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createSchedulesRouter } from './router.js';

const CUSTOM = {
  weekday: { startHour: 19, endHour: 7 },
  weekend: { startHour: 7, endHour: 19 },
  holiday: { startHour: 8, endHour: 8 },
};

type CustomTimes = typeof CUSTOM;

describe.skipIf(!process.env['TEST_DATABASE_URL'])('shift settings (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;
  let manager: TestUser;
  let member: TestUser;

  const call = (method: string, path: string, user: TestUser, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        cookie: user.cookie,
        ...(method === 'GET' ? {} : csrfHeaders),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) =>
      a.route('/', createSchedulesRouter({ db: sql, now: () => new Date('2027-06-01T12:00:00Z') })),
    );
    manager = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
    member = await loginAs(sql, { email: 'm@x.com' });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('starts with the default 18h–08h weekday and 08h–08h weekend/holiday', async () => {
    const res = await call('GET', '/shift-settings', member);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      weekday: { startHour: 18, endHour: 8 },
      weekend: { startHour: 8, endHour: 8 },
      holiday: { startHour: 8, endHour: 8 },
    });
  });

  it('only managers update, with validation', async () => {
    expect((await call('PUT', '/shift-settings', member, CUSTOM)).status).toBe(403);
    const bad = { ...CUSTOM, weekday: { startHour: 24, endHour: 7 } };
    expect((await call('PUT', '/shift-settings', manager, bad)).status).toBe(400);
    expect(
      (await call('PUT', '/shift-settings', manager, { weekday: CUSTOM.weekday })).status,
    ).toBe(400);
  });

  it('saves, audits and applies the times to newly generated schedules', async () => {
    const res = await call('PUT', '/shift-settings', manager, CUSTOM);
    expect(res.status).toBe(200);
    expect(await (await call('GET', '/shift-settings', member)).json()).toEqual(CUSTOM);
    const [audit] = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'shift_settings'`;
    expect(audit?.action).toBe('shift_settings.update');

    // 2027-06-07 segunda, 2027-06-12 sábado.
    const gen = await call('POST', '/schedules/generate', manager, {
      from: '2027-06-07',
      to: '2027-06-12',
    });
    expect(gen.status).toBe(201);
    const { shifts } = (await gen.json()) as {
      shifts: Array<{ date: string; hours: number; startsAt: string; endsAt: string }>;
    };
    const monday = shifts.find((s) => s.date === '2027-06-07')!;
    expect(monday).toMatchObject({
      hours: 12,
      startsAt: '2027-06-07T22:00:00.000Z',
      endsAt: '2027-06-08T10:00:00.000Z',
    });
    const saturday = shifts.find((s) => s.date === '2027-06-12')!;
    expect(saturday).toMatchObject({
      hours: 12,
      startsAt: '2027-06-12T10:00:00.000Z',
      endsAt: '2027-06-12T22:00:00.000Z',
    });
  });

  it('jornada de trabalho: padrão 08h00–12h00 | 13h30–18h00, só gestor altera e valida', async () => {
    const res = await call('GET', '/work-hours', member);
    expect(await res.json()).toEqual({
      periods: [
        { startMinute: 480, endMinute: 720 },
        { startMinute: 810, endMinute: 1080 },
      ],
    });
    const next = { periods: [{ startMinute: 540, endMinute: 1020 }] };
    expect((await call('PUT', '/work-hours', member, next)).status).toBe(403);
    const overlap = {
      periods: [
        { startMinute: 480, endMinute: 720 },
        { startMinute: 700, endMinute: 900 },
      ],
    };
    expect((await call('PUT', '/work-hours', manager, overlap)).status).toBe(400);
    expect((await call('PUT', '/work-hours', manager, { periods: 1 })).status).toBe(400);
    // Sem limite de períodos, fora de ordem e encostados são aceitos; vêm ordenados.
    const many = Array.from({ length: 10 }, (_, i) => ({
      startMinute: i * 120,
      endMinute: i * 120 + 120,
    }));
    expect(
      (await call('PUT', '/work-hours', manager, { periods: [...many].reverse() })).status,
    ).toBe(200);
    expect(await (await call('GET', '/work-hours', member)).json()).toEqual({ periods: many });
    // Nome opcional: aparado, vazio vira ausente, limite de 60 caracteres.
    const named = {
      periods: [
        { startMinute: 480, endMinute: 720, name: '  Manhã ' },
        { startMinute: 810, endMinute: 1080, name: '   ' },
      ],
    };
    expect((await call('PUT', '/work-hours', manager, named)).status).toBe(200);
    expect(await (await call('GET', '/work-hours', member)).json()).toEqual({
      periods: [
        { startMinute: 480, endMinute: 720, name: 'Manhã' },
        { startMinute: 810, endMinute: 1080 },
      ],
    });
    const longName = { periods: [{ startMinute: 0, endMinute: 60, name: 'x'.repeat(61) }] };
    expect((await call('PUT', '/work-hours', manager, longName)).status).toBe(400);
    expect((await call('PUT', '/work-hours', manager, next)).status).toBe(200);
    expect(await (await call('GET', '/work-hours', member)).json()).toEqual(next);
    const [audit] = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'work_hours'`;
    expect(audit?.action).toBe('work_hours.update');
  });

  it('horário por dia da semana: vários dias e feriado de uma vez, exclui e vale na geração', async () => {
    const body = { weekdays: [1, 3, 6], holiday: true, startHour: 16, endHour: 8 };
    expect((await call('PUT', '/shift-weekday-times', member, body)).status).toBe(403);
    const empty = { weekdays: [], holiday: false, startHour: 16, endHour: 8 };
    expect((await call('PUT', '/shift-weekday-times', manager, empty)).status).toBe(400);
    expect(
      (await call('PUT', '/shift-weekday-times', manager, { ...body, weekdays: [7] })).status,
    ).toBe(400);
    expect((await call('PUT', '/shift-weekday-times', manager, body)).status).toBe(200);
    expect(await (await call('GET', '/shift-weekday-times', member)).json()).toEqual([
      { weekday: 1, startHour: 16, endHour: 8 },
      { weekday: 3, startHour: 16, endHour: 8 },
      { weekday: 6, startHour: 16, endHour: 8 },
    ]);
    expect(
      ((await (await call('GET', '/shift-settings', member)).json()) as CustomTimes).holiday,
    ).toEqual({
      startHour: 16,
      endHour: 8,
    });

    // 2027-07-05 segunda, 06 terça (horário de dia útil), 07 quarta, 10 sábado.
    const gen = await call('POST', '/schedules/generate', manager, {
      from: '2027-07-05',
      to: '2027-07-10',
    });
    expect(gen.status).toBe(201);
    const { shifts } = (await gen.json()) as { shifts: Array<{ date: string; hours: number }> };
    expect(shifts.map((s) => s.hours)).toEqual([16, 12, 16, 12, 12, 16]);

    const edit = { weekdays: [1], holiday: false, startHour: 17, endHour: 8 };
    expect((await call('PUT', '/shift-weekday-times', manager, edit)).status).toBe(200);
    const audits = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'shift_weekday_times' order by id`;
    expect(audits.map((a) => a.action)).toEqual([
      'shift_weekday_times.update',
      'shift_weekday_times.update',
    ]);

    expect((await call('DELETE', '/shift-weekday-times?weekdays=1,3,6', member)).status).toBe(403);
    expect((await call('DELETE', '/shift-weekday-times?weekdays=', manager)).status).toBe(400);
    expect((await call('DELETE', '/shift-weekday-times?weekdays=1,3,6', manager)).status).toBe(204);
    expect((await call('DELETE', '/shift-weekday-times?weekdays=1,3,6', manager)).status).toBe(404);
    expect(await (await call('GET', '/shift-weekday-times', member)).json()).toEqual([]);
  });

  it('exceções por data: só gestor altera, valida, audita e a geração usa o horário da exceção', async () => {
    const body = { startHour: 15, endHour: 8, workPeriods: [{ startMinute: 480, endMinute: 900 }] };
    expect((await call('PUT', '/shift-exceptions/2027-06-22', member, body)).status).toBe(403);
    expect((await call('PUT', '/shift-exceptions/2027-13-40', manager, body)).status).toBe(400);
    const bad = { ...body, startHour: 24 };
    expect((await call('PUT', '/shift-exceptions/2027-06-22', manager, bad)).status).toBe(400);
    const overlap = {
      ...body,
      workPeriods: [
        { startMinute: 480, endMinute: 720 },
        { startMinute: 700, endMinute: 900 },
      ],
    };
    expect((await call('PUT', '/shift-exceptions/2027-06-22', manager, overlap)).status).toBe(400);

    expect((await call('PUT', '/shift-exceptions/2027-06-22', manager, body)).status).toBe(200);
    expect(await (await call('GET', '/shift-exceptions', member)).json()).toEqual([
      { date: '2027-06-22', ...body, note: null },
    ]);
    const [audit] = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'shift_exception'`;
    expect(audit?.action).toBe('shift_exception.create');

    // 2027-06-21 segunda (horário do tipo de dia), 2027-06-22 terça (exceção 15h–08h = 17h).
    const gen = await call('POST', '/schedules/generate', manager, {
      from: '2027-06-21',
      to: '2027-06-22',
    });
    expect(gen.status).toBe(201);
    const { shifts } = (await gen.json()) as {
      shifts: Array<{ date: string; hours: number; startsAt: string; endsAt: string }>;
    };
    expect(shifts.find((x) => x.date === '2027-06-21')).toMatchObject({ hours: 12 });
    expect(shifts.find((x) => x.date === '2027-06-22')).toMatchObject({
      hours: 17,
      startsAt: '2027-06-22T18:00:00.000Z',
      endsAt: '2027-06-23T11:00:00.000Z',
    });

    expect((await call('DELETE', '/shift-exceptions/2027-06-22', member)).status).toBe(403);
    expect((await call('DELETE', '/shift-exceptions/2027-06-22', manager)).status).toBe(204);
    expect((await call('DELETE', '/shift-exceptions/2027-06-22', manager)).status).toBe(404);
    expect(await (await call('GET', '/shift-exceptions', member)).json()).toEqual([]);
  });
});
