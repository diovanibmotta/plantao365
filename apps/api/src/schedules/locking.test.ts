import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createHolidaysRouter } from '../holidays/router.js';
import { createSwapsRouter } from '../swaps/router.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createSchedulesRouter } from './router.js';

const NOW = new Date('2026-11-23T12:00:00Z');
const D1 = '2027-03-10';
const D2 = '2027-03-11';
const ROUNDS = 12;

describe.skipIf(!process.env['TEST_DATABASE_URL'])('ordem canônica de locks (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;
  let caio: TestUser;

  const call = (method: string, path: string, user: TestUser, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        cookie: user.cookie,
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) => {
      a.route('/', createSchedulesRouter({ db: sql }));
      a.route('/', createSwapsRouter({ db: sql, now: () => NOW }));
      a.route('/', createHolidaysRouter({ db: sql }));
    });
    manager = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
    ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
    bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });
    caio = await loginAs(sql, { email: 'caio@x.com', name: 'Caio' });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('edição + aprovação de troca + recálculo concorrentes não dão 40P01 nem 500', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await sql`truncate swaps, shifts, schedules, holidays cascade`;
      const [s] = await sql<{ id: string }[]>`
          insert into schedules (start_date, end_date, status, created_by, published_at)
          values (${D1}::date, ${D2}::date, 'published', ${manager.id}, now()) returning id`;
      const ins = async (date: string, userId: string) =>
        (
          await sql<{ id: string }[]>`
              insert into shifts (schedule_id, date, day_type, hours, user_id, original_user_id,
                original_hours)
              values (${s!.id}, ${date}::date, 'weekday', 14, ${userId}, ${userId}, 14)
              returning id`
        )[0]!.id;
      const a1 = await ins(D1, ana.id);
      const b2 = await ins(D2, bia.id);
      await sql`insert into holidays (date, name, scope) values (${D1}::date, 'H', 'national')`;
      await sql`insert into holidays (date, name, scope) values (${D2}::date, 'H', 'national')`;

      const created = await call('POST', '/swaps', ana, {
        kind: 'swap',
        shiftId: a1,
        counterpartId: bia.id,
        counterpartShiftId: b2,
      });
      expect(created.status).toBe(201);
      const swapId = ((await created.json()) as { swap: { id: string } }).swap.id;
      expect((await call('POST', `/swaps/${swapId}/accept`, bia)).status).toBe(200);

      const results = await Promise.all([
        call('PATCH', `/schedules/${s!.id}/shifts/${a1}`, manager, {
          userId: caio.id,
          reason: 'ajuste',
        }),
        call('POST', `/swaps/${swapId}/approve`, manager),
        call('POST', '/holidays/recalculate', manager, { dates: [D1, D2] }),
        call('PATCH', `/schedules/${s!.id}/shifts/${b2}`, manager, {
          userId: ana.id,
          reason: 'ajuste',
        }),
      ]);
      for (const r of results) {
        expect(r.status, await r.clone().text()).toBeLessThan(500);
      }
      expect(results[0]!.status).toBe(200);
      expect(results[2]!.status).toBe(200);
    }
  });
});
