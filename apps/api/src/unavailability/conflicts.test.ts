import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createUnavailabilityRouter } from './index.js';
import type { ScheduleImpactNotifier, ScheduleImpactTrigger } from '../schedule-impact/index.js';
import type { CollectiveImpactChecker, UnavailabilityConflictEvent } from './types.js';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('avisos de conflito (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let ana: TestUser;
  let events: UnavailabilityConflictEvent[];
  let impactCalls: string[][];
  let failHook = false;
  let triggers: ScheduleImpactTrigger[];
  let impactOn = false;
  const notifier: ScheduleImpactNotifier = async (_sql, trigger) => {
    triggers.push(trigger);
    if (!impactOn) return null;
    return {
      source: trigger.source,
      removed: trigger.removed === true,
      shifts: 1,
      dates: ['2026-12-03'],
      teams: [],
      message: 'aviso',
    };
  };

  const impact: CollectiveImpactChecker = async (_sql, dates) => {
    impactCalls.push(dates);
    return dates.filter((d) => d !== '2026-12-25').map((d) => ({ date: d, count: 2 }));
  };
  const app = () =>
    buildTestApp(sql, (a) =>
      a.route(
        '/',
        createUnavailabilityRouter({
          db: sql,
          conflictChecker: async (_s, args) =>
            args.userId ? [{ date: '2026-12-03', userId: args.userId }] : [],
          collectiveImpactChecker: impact,
          scheduleImpactNotifier: notifier,
          onConflict: (e) => {
            events.push(e);
            if (failHook) throw new Error('boom');
          },
        }),
      ),
    );
  const call = (method: string, path: string, user: TestUser, body: unknown) =>
    app().request(path, {
      method,
      headers: {
        cookie: user.cookie,
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`truncate unavailabilities, sessions, users cascade`;
    manager = await loginAs(sql, { email: 'gestor@x.com', role: 'manager' });
    ana = await loginAs(sql, { email: 'ana@x.com' });
    events = [];
    impactCalls = [];
    triggers = [];
    impactOn = false;
    failHook = false;
  });

  const mine = { kind: 'vacation', startDate: '2026-12-01', endDate: '2026-12-05', note: 'x' };

  it('membro com conflito dispara onConflict (POST e PATCH), sem tipo/observação', async () => {
    const res = await call('POST', '/unavailabilities', ana, mine);
    expect(res.status).toBe(201);
    const { unavailability: u } = await res.json();
    expect(events).toEqual([
      {
        unavailabilityId: u.id,
        userId: ana.id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        dates: ['2026-12-03'],
        actorId: ana.id,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('vacation');
    const patch = await call('PATCH', `/unavailabilities/${u.id}`, ana, { endDate: '2026-12-06' });
    expect(patch.status).toBe(200);
    expect(events).toHaveLength(2);
  });

  it('erro no gancho não afeta a resposta; gestor autor não dispara', async () => {
    failHook = true;
    const res = await call('POST', '/unavailabilities', ana, mine);
    expect(res.status).toBe(201);
    expect((await res.json()).warnings).toHaveLength(1);
    events = [];
    const byManager = await call('POST', '/unavailabilities', manager, { ...mine, userId: ana.id });
    expect(byManager.status).toBe(201);
    expect(events).toEqual([]);
  });

  it('férias coletivas: POST e PATCH retornam published_shifts_affected por data', async () => {
    const res = await call('POST', '/unavailabilities', manager, {
      kind: 'collective_vacation',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(impactCalls[0]).toEqual(['2026-12-24', '2026-12-25', '2026-12-26']);
    expect(body.warnings).toEqual([
      { type: 'published_shifts_affected', date: '2026-12-24', count: 2 },
      { type: 'published_shifts_affected', date: '2026-12-26', count: 2 },
    ]);
    const patch = await call('PATCH', `/unavailabilities/${body.unavailability.id}`, manager, {
      endDate: '2026-12-27',
    });
    expect((await patch.json()).warnings.map((w: { date: string }) => w.date)).toEqual([
      '2026-12-24',
      '2026-12-26',
      '2026-12-27',
    ]);
    expect(events).toEqual([]);
  });

  it('regra core: sem confirmação o impacto devolve 409 e nada é salvo; confirmado salva', async () => {
    impactOn = true;
    const refused = await call('POST', '/unavailabilities', manager, { ...mine, userId: ana.id });
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toBe('schedule_impact_confirmation_required');
    expect(body.message).toContain('serão avisados por e-mail');
    expect(body.scheduleImpact.dates).toEqual(['2026-12-03']);
    expect((await sql`select 1 from unavailabilities`).length).toBe(0);

    const ok = await call('POST', '/unavailabilities?confirmImpact=true', manager, {
      ...mine,
      userId: ana.id,
    });
    expect(ok.status).toBe(201);
    expect((await ok.json()).scheduleImpact.message).toContain('avisados por e-mail');
    expect((await sql`select 1 from unavailabilities`).length).toBe(1);
  });

  it('regra core: gestor ou membro, individual ou coletiva, edição e exclusão acionam o notificador', async () => {
    impactOn = true;
    const q = '?confirmImpact=true';
    await call('POST', `/unavailabilities${q}`, manager, { ...mine, userId: ana.id });
    const coll = await call('POST', `/unavailabilities${q}`, manager, {
      kind: 'collective_vacation',
      startDate: '2026-12-24',
      endDate: '2026-12-26',
    });
    expect((await coll.json()).scheduleImpact.source).toBe('collective_vacation');
    const byMember = await call('POST', `/unavailabilities${q}`, ana, mine);
    const { unavailability: u } = await byMember.json();
    const patch = await call('PATCH', `/unavailabilities/${u.id}${q}`, ana, {
      endDate: '2026-12-06',
    });
    expect((await patch.json()).scheduleImpact.shifts).toBe(1);
    expect((await call('DELETE', `/unavailabilities/${u.id}`, ana, undefined)).status).toBe(409);
    expect((await call('DELETE', `/unavailabilities/${u.id}${q}`, ana, undefined)).status).toBe(
      204,
    );
    expect(triggers.map((t) => [t.source, t.removed ?? false])).toEqual([
      ['member_exception', false],
      ['collective_vacation', false],
      ['member_exception', false],
      ['member_exception', false],
      ['member_exception', true],
      ['member_exception', true],
    ]);
  });
});
