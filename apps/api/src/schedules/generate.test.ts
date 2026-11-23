import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createSchedulesRouter } from './router.js';

// 2027-06-07 é segunda; 06-09 feriado (quarta); 06-10 férias coletivas (quinta); 06-12/13 fim de semana.
const FROM = '2027-06-07';
const TO = '2027-06-13';

interface ShiftOut {
  date: string;
  userId: string | null;
  dayType: string;
  hours: number;
  originalUserId: string | null;
  originalHours: number | null;
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])('POST /schedules/generate (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;
  let caio: TestUser;
  let inactive: TestUser;
  let observer: TestUser;

  const generate = (body: unknown, user: TestUser | null = manager) =>
    app.request('/schedules/generate', {
      method: 'POST',
      headers: {
        ...csrfHeaders,
        'content-type': 'application/json',
        ...(user ? { cookie: user.cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) =>
      a.route('/', createSchedulesRouter({ db: sql, now: () => new Date('2027-06-01T12:00:00Z') })),
    );
    manager = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
    ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
    bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });
    caio = await loginAs(sql, { email: 'caio@x.com', name: 'Caio' });
    inactive = await loginAs(sql, { email: 'off@x.com', name: 'Inativo', active: false });
    observer = await loginAs(sql, {
      email: 'obs@x.com',
      name: 'Observador',
      participatesInRotation: false,
    });
    await sql`update users set participates_in_rotation = false where id = ${manager.id}`;
    await sql`insert into holidays (date, name, scope) values ('2027-06-09', 'Feriado teste', 'municipal')`;
    await sql`insert into unavailabilities (user_id, kind, start_date, end_date)
      values (null, 'collective_vacation', '2027-06-10', '2027-06-10')`;
    await sql`insert into unavailabilities (user_id, kind, start_date, end_date)
      values (${ana.id}, 'vacation', '2027-06-08', '2027-06-08')`;
  });

  afterAll(async () => {
    await t.drop();
  });

  it('gestor gera rascunho com todos os dias, tipos, horas e responsáveis elegíveis', async () => {
    const res = await generate({ from: FROM, to: TO });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      schedule: { id: string; status: string; startDate: string; endDate: string };
      shifts: ShiftOut[];
      unassignedDates: string[];
      preferenceViolations: unknown[];
      summary: Array<{ userId: string; hours: number }>;
    };
    expect(body.schedule).toMatchObject({ status: 'draft', startDate: FROM, endDate: TO });
    expect(body.shifts).toHaveLength(7);
    const byDate = new Map(body.shifts.map((s) => [s.date, s]));
    expect(byDate.get('2027-06-07')).toMatchObject({ dayType: 'weekday', hours: 14 });
    expect(byDate.get('2027-06-09')).toMatchObject({ dayType: 'holiday', hours: 24 });
    expect(byDate.get('2027-06-10')).toMatchObject({
      dayType: 'collective_vacation',
      hours: 0,
      userId: null,
    });
    expect(byDate.get('2027-06-12')).toMatchObject({ dayType: 'weekend', hours: 24 });
    expect(body.unassignedDates).toEqual([]);
    expect(byDate.get('2027-06-08')!.userId).not.toBe(ana.id);

    const allowed = new Set([ana.id, bia.id, caio.id]);
    for (const s of body.shifts) {
      if (s.dayType !== 'collective_vacation') expect(allowed.has(s.userId!)).toBe(true);
      expect(s.originalUserId).toBeNull();
      expect(s.originalHours).toBeNull();
    }
    expect(body.summary.map((m) => m.userId).sort()).toEqual([ana.id, bia.id, caio.id].sort());
    expect(inactive.id).not.toBe(observer.id);

    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from shifts where schedule_id = ${body.schedule.id}`;
    expect(row!.n).toBe(7);
    const [draftRow] = await sql<{ status: string }[]>`
      select status from schedules where id = ${body.schedule.id}`;
    expect(draftRow!.status).toBe('draft');
  });

  it('grava auditoria schedule.generate na mesma operação', async () => {
    const rows = await sql<{ actor_id: string; entity_type: string; after: { shifts: number } }[]>`
      select actor_id, entity_type, after from audit_log where action = 'schedule.generate'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: manager.id,
      entity_type: 'schedule',
      after: { shifts: 7 },
    });
  });

  it('recusa com 409 período que se sobrepõe a rascunho existente, sem criar nada', async () => {
    const before = await sql<{ n: number }[]>`select count(*)::int as n from schedules`;
    for (const range of [
      { from: '2027-06-13', to: '2027-06-20' },
      { from: '2027-06-01', to: '2027-06-07' },
      { from: '2027-06-08', to: '2027-06-09' },
      { from: '2027-05-01', to: '2027-07-01' },
    ]) {
      const res = await generate(range);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe('schedule_overlap');
    }
    const after = await sql<{ n: number }[]>`select count(*)::int as n from schedules`;
    expect(after[0]!.n).toBe(before[0]!.n);
    const adjacent = await generate({ from: '2027-06-14', to: '2027-06-14' });
    expect(adjacent.status).toBe(201);
  });

  it('membro recebe 403 e não autenticado 401', async () => {
    expect((await generate({ from: '2028-01-03', to: '2028-01-05' }, ana)).status).toBe(403);
    expect((await generate({ from: '2028-01-03', to: '2028-01-05' }, null)).status).toBe(401);
  });

  it('valida o corpo (400)', async () => {
    for (const body of [
      {},
      { from: '2028-01-05', to: '2028-01-03' },
      { from: '2028-02-30', to: '2028-03-01' },
      { from: '2028-01-01', to: '2029-01-01' },
      { from: 'x', to: 'y' },
    ]) {
      expect((await generate(body)).status).toBe(400);
    }
    expect((await generate({ from: '2028-01-01', to: '2028-12-31' })).status).toBe(201);
  });

  it('é determinístico: mesmos dados geram as mesmas atribuições', async () => {
    const run = async (from: string, to: string) => {
      const res = await generate({ from, to });
      expect(res.status).toBe(201);
      const b = (await res.json()) as { shifts: ShiftOut[] };
      return b.shifts.map((s) => [s.date.slice(5), s.userId]);
    };
    const first = await run('2029-03-05', '2029-03-18');
    await sql`delete from schedules where start_date = '2029-03-05'`;
    const second = await run('2029-03-05', '2029-03-18');
    expect(second).toEqual(first);
  });

  it('dia sem elegível fica sem responsável e é sinalizado', async () => {
    await sql`insert into unavailabilities (user_id, kind, start_date, end_date)
      select id, 'time_off', '2030-01-02', '2030-01-02' from users
      where active and participates_in_rotation`;
    const res = await generate({ from: '2030-01-01', to: '2030-01-03' });
    const body = (await res.json()) as { shifts: ShiftOut[]; unassignedDates: string[] };
    expect(body.unassignedDates).toEqual(['2030-01-02']);
    expect(body.shifts.find((s) => s.date === '2030-01-02')).toMatchObject({
      userId: null,
      hours: 14,
    });
  });

  it('usa o histórico de horas realizadas: quem já fez mais recebe menos', async () => {
    await sql`insert into hour_adjustments (user_id, date, hours, reason, created_by)
      values (${bia.id}, '2026-01-10', 400, 'histórico', ${manager.id}),
             (${caio.id}, '2026-01-10', 400, 'histórico', ${manager.id})`;
    const res = await generate({ from: '2031-03-03', to: '2031-03-05' });
    const body = (await res.json()) as { shifts: ShiftOut[] };
    expect(new Set(body.shifts.map((s) => s.userId))).toEqual(new Set([ana.id]));
  });
});
