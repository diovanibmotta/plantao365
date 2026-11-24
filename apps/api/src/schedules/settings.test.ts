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
});
