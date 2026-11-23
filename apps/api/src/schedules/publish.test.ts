import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import type { ShiftChange } from './edit.js';
import type { PublishedEvent } from './publish.js';
import { createSchedulesRouter } from './router.js';

const NOW = new Date('2027-06-01T12:00:00Z');

describe.skipIf(!process.env['TEST_DATABASE_URL'])('publicar/editar escalas (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;
  let off: TestUser;
  let obs: TestUser;
  const changes: ShiftChange[] = [];
  const published: PublishedEvent[] = [];

  const call = (method: string, url: string, user: TestUser | null, body?: unknown) =>
    app.request(url, {
      method,
      headers: {
        ...csrfHeaders,
        'content-type': 'application/json',
        ...(user ? { cookie: user.cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function seed(
    status: 'draft' | 'published',
    start: string,
    dates: Array<[string, string | null, number?]>,
  ): Promise<{ id: string; shifts: Map<string, string> }> {
    const [s] = await sql<{ id: string }[]>`
      insert into schedules (start_date, end_date, status, created_by)
      values (${start}::date, ${dates[dates.length - 1]![0]}::date, ${status}, ${manager.id})
      returning id`;
    const shifts = new Map<string, string>();
    for (const [date, userId, hours = 14] of dates) {
      const [r] = await sql<{ id: string }[]>`
        insert into shifts (schedule_id, date, day_type, hours, user_id,
          original_user_id, original_hours)
        values (${s!.id}, ${date}::date, ${hours === 0 ? 'collective_vacation' : 'weekday'},
          ${hours}, ${userId},
          ${status === 'published' ? userId : null}, ${status === 'published' ? hours : null})
        returning id`;
      shifts.set(date, r!.id);
    }
    return { id: s!.id, shifts };
  }

  const audit = (action: string) =>
    sql<
      {
        actor_id: string;
        entity_id: string;
        before: unknown;
        after: unknown;
        reason: string | null;
      }[]
    >`select actor_id, entity_id, before, after, reason from audit_log where action = ${action}
      order by id`;

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) =>
      a.route(
        '/',
        createSchedulesRouter({
          db: sql,
          now: () => NOW,
          onShiftChanged: (c) => {
            changes.push(c);
          },
          onPublished: (e) => {
            published.push(e);
          },
        }),
      ),
    );
    manager = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
    ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
    bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });
    off = await loginAs(sql, { email: 'off@x.com', name: 'Inativo', active: false });
    obs = await loginAs(sql, {
      email: 'obs@x.com',
      name: 'Observador',
      participatesInRotation: false,
    });
    await sql`insert into unavailabilities (user_id, kind, start_date, end_date)
      values (${ana.id}, 'vacation', '2027-07-02', '2027-07-02')`;
    await sql`insert into unavailabilities (user_id, kind, start_date, end_date)
      values (null, 'collective_vacation', '2027-07-03', '2027-07-03')`;
  });

  afterAll(async () => {
    await t.drop();
  });

  describe('PATCH em rascunho', () => {
    it('troca o responsável, sem motivo, audita e não aciona hook', async () => {
      const d = await seed('draft', '2027-07-01', [['2027-07-01', ana.id]]);
      const res = await call(
        'PATCH',
        `/schedules/${d.id}/shifts/${d.shifts.get('2027-07-01')}`,
        manager,
        {
          userId: bia.id,
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        shift: { userId: string };
        warnings: unknown[];
        notice?: string;
      };
      expect(body.shift.userId).toBe(bia.id);
      expect(body.warnings).toEqual([]);
      expect(body.notice).toBeUndefined();
      const rows = (await audit('schedule.shift_edit')).filter(
        (r) => r.entity_id === d.shifts.get('2027-07-01'),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: manager.id,
        before: { userId: ana.id },
        after: { userId: bia.id },
      });
      expect(changes).toHaveLength(0);
    });

    it('devolve avisos de conflito (inativo, fora do revezamento, exceção, férias coletivas)', async () => {
      const d = await seed('draft', '2027-07-02', [
        ['2027-07-02', bia.id],
        ['2027-07-03', null, 0],
        ['2027-07-04', bia.id],
      ]);
      const url = (date: string) => `/schedules/${d.id}/shifts/${d.shifts.get(date)}`;
      const warn = async (date: string, userId: string | null) =>
        (
          (await (await call('PATCH', url(date), manager, { userId })).json()) as {
            warnings: Array<{ code: string }>;
          }
        ).warnings.map((w) => w.code);
      expect(await warn('2027-07-02', ana.id)).toEqual(['user_unavailable']);
      expect(await warn('2027-07-04', off.id)).toEqual(['user_inactive']);
      expect(await warn('2027-07-04', obs.id)).toEqual(['user_not_in_rotation']);
      expect(await warn('2027-07-04', null)).toEqual(['unassigned']);
      const vac = await call('PATCH', url('2027-07-03'), manager, { userId: ana.id });
      expect(vac.status).toBe(422);
      expect(await warn('2027-07-03', null)).toEqual([]);
      await sql`update shifts set hours = 14 where id = ${d.shifts.get('2027-07-03')}`;
      expect(await warn('2027-07-03', bia.id)).toEqual(['collective_vacation']);
    });

    it('404 para plantão/usuário inexistente e 400 para corpo inválido', async () => {
      const d = await seed('draft', '2027-08-01', [['2027-08-01', ana.id]]);
      const url = `/schedules/${d.id}/shifts/${d.shifts.get('2027-08-01')}`;
      const zero = '00000000-0000-4000-8000-000000000000';
      expect(
        (await call('PATCH', `/schedules/${d.id}/shifts/${zero}`, manager, { userId: null }))
          .status,
      ).toBe(404);
      expect(
        (await call('PATCH', `/schedules/${zero}/shifts/${zero}`, manager, { userId: null }))
          .status,
      ).toBe(404);
      expect((await call('PATCH', url, manager, { userId: zero })).status).toBe(400);
      expect((await call('PATCH', url, manager, { userId: 'x' })).status).toBe(400);
      expect((await call('PATCH', url, manager, {})).status).toBe(400);
    });

    it('membro 403 e anônimo 401', async () => {
      const d = await seed('draft', '2027-09-01', [['2027-09-01', ana.id]]);
      const url = `/schedules/${d.id}/shifts/${d.shifts.get('2027-09-01')}`;
      expect((await call('PATCH', url, ana, { userId: bia.id })).status).toBe(403);
      expect((await call('PATCH', url, null, { userId: bia.id })).status).toBe(401);
      expect((await call('POST', `/schedules/${d.id}/publish`, ana, {})).status).toBe(403);
      expect((await call('DELETE', `/schedules/${d.id}`, ana)).status).toBe(403);
    });
  });

  describe('publicar', () => {
    it('publica, grava original_*, published_at, audita e aciona onPublished', async () => {
      const d = await seed('draft', '2028-01-01', [
        ['2028-01-01', ana.id, 24],
        ['2028-01-02', bia.id],
      ]);
      const res = await call('POST', `/schedules/${d.id}/publish`, manager, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { schedule: { status: string; publishedAt: string } };
      expect(body.schedule.status).toBe('published');
      expect(body.schedule.publishedAt).toBe(NOW.toISOString());
      const rows = await sql<{ date: string; original_user_id: string; original_hours: number }[]>`
        select date::text as date, original_user_id, original_hours from shifts
        where schedule_id = ${d.id} order by date`;
      expect(rows).toEqual([
        { date: '2028-01-01', original_user_id: ana.id, original_hours: 24 },
        { date: '2028-01-02', original_user_id: bia.id, original_hours: 14 },
      ]);
      const [a] = await audit('schedule.publish');
      expect(a).toMatchObject({
        actor_id: manager.id,
        entity_id: d.id,
        before: { status: 'draft' },
      });
      expect(published.at(-1)?.schedule.id).toBe(d.id);
      expect((await call('POST', `/schedules/${d.id}/publish`, manager, {})).status).toBe(409);
    });

    it('edições do rascunho antes de publicar entram no snapshot original', async () => {
      const d = await seed('draft', '2028-02-01', [['2028-02-01', ana.id]]);
      await call('PATCH', `/schedules/${d.id}/shifts/${d.shifts.get('2028-02-01')}`, manager, {
        userId: bia.id,
      });
      await call('POST', `/schedules/${d.id}/publish`, manager, {});
      const [r] = await sql<{ original_user_id: string }[]>`
        select original_user_id from shifts where id = ${d.shifts.get('2028-02-01')}`;
      expect(r!.original_user_id).toBe(bia.id);
    });

    it('exige confirmação explícita com dias sem responsável aplicáveis', async () => {
      const d = await seed('draft', '2028-03-01', [
        ['2028-03-01', null],
        ['2028-03-02', null, 0],
        ['2028-03-03', ana.id],
      ]);
      const res = await call('POST', `/schedules/${d.id}/publish`, manager, {});
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: 'confirmation_required',
        unassignedDates: ['2028-03-01'],
      });
      const [still] = await sql<
        { status: string }[]
      >`select status from schedules where id = ${d.id}`;
      expect(still!.status).toBe('draft');
      expect(
        (await call('POST', `/schedules/${d.id}/publish`, manager, { confirmUnassigned: false }))
          .status,
      ).toBe(409);
      const ok = await call('POST', `/schedules/${d.id}/publish`, manager, {
        confirmUnassigned: true,
      });
      expect(ok.status).toBe(200);
      const [a] = (await audit('schedule.publish')).slice(-1);
      expect(a!.after).toMatchObject({
        confirmedUnassigned: true,
        unassignedDates: ['2028-03-01'],
      });
    });

    it('dias só de férias coletivas sem responsável não exigem confirmação', async () => {
      const d = await seed('draft', '2028-04-01', [
        ['2028-04-01', ana.id],
        ['2028-04-02', null, 0],
      ]);
      expect((await call('POST', `/schedules/${d.id}/publish`, manager)).status).toBe(200);
    });

    it('recusa com 409 se o período sobrepõe escala publicada', async () => {
      await seed('published', '2028-05-10', [
        ['2028-05-10', ana.id],
        ['2028-05-15', ana.id],
      ]);
      const d = await seed('draft', '2028-05-15', [
        ['2028-05-15', bia.id],
        ['2028-05-20', bia.id],
      ]);
      const res = await call('POST', `/schedules/${d.id}/publish`, manager, {});
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe('schedule_overlap_published');
      const adj = await seed('draft', '2028-05-16', [['2028-05-16', bia.id]]);
      expect((await call('POST', `/schedules/${adj.id}/publish`, manager, {})).status).toBe(200);
    });

    it('404 para escala inexistente', async () => {
      const zero = '00000000-0000-4000-8000-000000000000';
      expect((await call('POST', `/schedules/${zero}/publish`, manager, {})).status).toBe(404);
      expect((await call('POST', `/schedules/nope/publish`, manager, {})).status).toBe(404);
    });
  });

  describe('alterar escala publicada', () => {
    it('exige motivo, mantém original_*, audita com motivo, avisa e aciona hook', async () => {
      const d = await seed('draft', '2029-01-01', [['2029-01-01', ana.id, 24]]);
      await call('POST', `/schedules/${d.id}/publish`, manager, {});
      const url = `/schedules/${d.id}/shifts/${d.shifts.get('2029-01-01')}`;

      expect((await call('PATCH', url, manager, { userId: bia.id })).status).toBe(400);
      expect((await call('PATCH', url, manager, { userId: bia.id, reason: '   ' })).status).toBe(
        400,
      );
      const [unchanged] = await sql<{ user_id: string }[]>`
        select user_id from shifts where id = ${d.shifts.get('2029-01-01')}`;
      expect(unchanged!.user_id).toBe(ana.id);

      const res = await call('PATCH', url, manager, { userId: bia.id, reason: 'Atestado médico' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        shift: { userId: string; originalUserId: string; originalHours: number };
        notice: string;
        notify: string[];
      };
      expect(body.shift).toMatchObject({
        userId: bia.id,
        originalUserId: ana.id,
        originalHours: 24,
      });
      expect(body.notice).toMatch(/notificados/);
      expect(body.notify.sort()).toEqual([ana.id, bia.id].sort());

      const rows = (await audit('schedule.published_shift_change')).filter(
        (r) => r.entity_id === d.shifts.get('2029-01-01'),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: manager.id,
        reason: 'Atestado médico',
        before: { userId: ana.id },
        after: { userId: bia.id },
      });
      expect(changes.at(-1)).toMatchObject({
        previousUserId: ana.id,
        newUserId: bia.id,
        reason: 'Atestado médico',
        actorId: manager.id,
      });
    });

    it('falha do hook não desfaz a alteração', async () => {
      const failing = buildTestApp(sql, (a) =>
        a.route(
          '/',
          createSchedulesRouter({
            db: sql,
            onShiftChanged: () => {
              throw new Error('smtp fora');
            },
          }),
        ),
      );
      const d = await seed('published', '2029-02-01', [['2029-02-01', ana.id]]);
      const res = await failing.request(`/schedules/${d.id}/shifts/${d.shifts.get('2029-02-01')}`, {
        method: 'PATCH',
        headers: { ...csrfHeaders, 'content-type': 'application/json', cookie: manager.cookie },
        body: JSON.stringify({ userId: bia.id, reason: 'troca' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('descartar rascunho', () => {
    it('apaga rascunho com seus plantões e audita; publicada dá 409; inexistente 404', async () => {
      const d = await seed('draft', '2030-01-01', [['2030-01-01', ana.id]]);
      expect((await call('DELETE', `/schedules/${d.id}`, manager)).status).toBe(204);
      const [n] = await sql<
        { n: number }[]
      >`select count(*)::int as n from shifts where schedule_id = ${d.id}`;
      expect(n!.n).toBe(0);
      expect((await audit('schedule.discard')).some((r) => r.entity_id === d.id)).toBe(true);
      expect((await call('DELETE', `/schedules/${d.id}`, manager)).status).toBe(404);
      const p = await seed('published', '2030-02-01', [['2030-02-01', ana.id]]);
      expect((await call('DELETE', `/schedules/${p.id}`, manager)).status).toBe(409);
    });
  });

  describe('visibilidade para membros (Req. 8.6)', () => {
    it('rascunho oculto, publicada visível', async () => {
      const d = await seed('draft', '2031-01-01', [['2031-01-01', ana.id]]);
      expect(
        (await app.request(`/schedules/${d.id}`, { headers: { cookie: ana.cookie } })).status,
      ).toBe(404);
      await call('POST', `/schedules/${d.id}/publish`, manager, {});
      const res = await app.request(`/schedules/${d.id}`, { headers: { cookie: ana.cookie } });
      expect(res.status).toBe(200);
    });
  });
});
