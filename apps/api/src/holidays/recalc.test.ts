import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createOnShiftsRecalculated } from './recalc.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createHolidaysRouter } from './router.js';

const DATE = '2026-03-04';
const DRAFT_DATE = '2026-04-08';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('recálculo por feriado (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let member: TestUser;
  let published: string;
  let draft: string;

  const app = () =>
    buildTestApp(sql, (a) =>
      a.route(
        '/',
        createHolidaysRouter({
          db: sql,
          onShiftsRecalculated: createOnShiftsRecalculated({
            db: sql,
            appBaseUrl: 'https://plantao.example',
          }),
        }),
      ),
    );

  const recalc = (user: TestUser | null, body: unknown) =>
    app().request('/holidays/recalculate', {
      method: 'POST',
      headers: {
        ...(user ? { cookie: user.cookie } : {}),
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  const shiftOn = async (scheduleId: string, date: string) => {
    const [r] = await sql<
      {
        day_type: string;
        hours: number;
        starts_at: Date | null;
        original_hours: number;
        original_user_id: string | null;
      }[]
    >`select day_type, hours, starts_at, original_hours, original_user_id from shifts
      where schedule_id = ${scheduleId} and date = ${date}::date`;
    return r!;
  };

  async function insertSchedule(status: 'draft' | 'published', date: string): Promise<string> {
    const [s] = await sql<{ id: string }[]>`
      insert into schedules (start_date, end_date, status, created_by, published_at)
      values (${date}::date, ${date}::date, ${status}, ${manager.id},
        ${status === 'published' ? sql`now()` : null}) returning id`;
    await sql`
      insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id,
        original_user_id, original_hours)
      values (${s!.id}, ${date}::date, 'weekday', 14, ${`${date}T21:00:00Z`}, ${`${date}T11:00:00Z`},
        ${member.id}, ${member.id}, 14)`;
    return s!.id;
  }

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
    await sql`delete from email_outbox`;
    await sql`delete from schedules`;
    await sql`delete from holidays where date in (${DATE}::date, ${DRAFT_DATE}::date)`;
    published = await insertSchedule('published', DATE);
    draft = await insertSchedule('draft', DRAFT_DATE);
  });

  it('feriado criado vira 24h, audita, notifica e é idempotente', async () => {
    await sql`insert into holidays (date, name, scope) values (${DATE}::date, 'Teste', 'national')`;
    await sql`insert into holidays (date, name, scope) values (${DRAFT_DATE}::date, 'Teste2', 'national')`;
    const res = await recalc(manager, { dates: [DATE, DRAFT_DATE, DATE] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number; changes: { date: string }[] };
    expect(body.updated).toBe(1);
    expect(body.changes[0]).toMatchObject({ date: DATE, previousHours: 14, hours: 24 });

    expect(await shiftOn(published, DATE)).toMatchObject({
      day_type: 'holiday',
      hours: 24,
      original_hours: 14,
      original_user_id: member.id,
    });
    expect((await shiftOn(published, DATE)).starts_at?.toISOString()).toBe(`${DATE}T11:00:00.000Z`);
    expect(await shiftOn(draft, DRAFT_DATE)).toMatchObject({ day_type: 'weekday', hours: 14 });

    const audit = await sql<{ action: string; reason: string; before: { hours: number } }[]>`
      select action, reason, before from audit_log where action = 'shift.holiday_recalc'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: 'Recálculo por feriado', before: { hours: 14 } });

    const outbox = await sql<{ to_address: string }[]>`select to_address from email_outbox`;
    expect(outbox.map((o) => o.to_address)).toEqual(['membro@example.com']);

    const again = await recalc(manager, { dates: [DATE] });
    expect(((await again.json()) as { updated: number }).updated).toBe(0);
    expect(await sql`select 1 from email_outbox`).toHaveLength(1);
    expect(await sql`select 1 from audit_log where action = 'shift.holiday_recalc'`).toHaveLength(
      1,
    );
  });

  it('feriado removido volta a 14h', async () => {
    await sql`insert into holidays (date, name, scope) values (${DATE}::date, 'Teste', 'national')`;
    await recalc(manager, { dates: [DATE] });
    await sql`delete from holidays where date = ${DATE}::date`;
    const res = await recalc(manager, { dates: [DATE] });
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    expect(await shiftOn(published, DATE)).toMatchObject({
      day_type: 'weekday',
      hours: 14,
      original_hours: 14,
    });
    expect((await shiftOn(published, DATE)).starts_at?.toISOString()).toBe(`${DATE}T21:00:00.000Z`);
  });

  it('membro recebe 403, anônimo 401 e corpo inválido 400', async () => {
    expect((await recalc(member, { dates: [DATE] })).status).toBe(403);
    expect((await recalc(null, { dates: [DATE] })).status).toBe(401);
    expect((await recalc(manager, { dates: [] })).status).toBe(400);
    expect((await recalc(manager, { dates: ['2026-13-40'] })).status).toBe(400);
  });
});
