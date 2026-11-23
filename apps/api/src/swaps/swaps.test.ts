import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createOnSwapEvent } from '../notifications/swap-events.js';
import { createSwapsRouter, type SwapEvent } from './index.js';

const NOW = new Date('2026-11-23T12:00:00Z');

describe.skipIf(!process.env['TEST_DATABASE_URL'])('swaps (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;
  let caio: TestUser;
  let events: SwapEvent[];
  let hookFails = false;
  let realHook = false;
  let sched: string;
  const shift: Record<string, string> = {};

  const app = () =>
    buildTestApp(sql, (a) =>
      a.route(
        '/',
        createSwapsRouter({
          db: sql,
          now: () => NOW,
          onSwapEvent: async (e, tx) => {
            if (realHook) return createOnSwapEvent({ db: sql, now: () => NOW })(e, tx);
            events.push(e);
            if (hookFails) {
              await tx`
                insert into email_outbox (to_address, subject, text, dedupe_key)
                values ('x@x.com', 's', 't', ${`falha:${e.swap.id}`})`;
              throw new Error('smtp fora');
            }
          },
        }),
      ),
    );

  const call = (
    method: string,
    path: string,
    user: TestUser | null,
    body?: unknown,
  ): Promise<Response> =>
    app().request(path, {
      method,
      headers: {
        ...(user ? { cookie: user.cookie } : {}),
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function insertSchedule(start: string, end: string, status: string): Promise<string> {
    const [r] = await sql<{ id: string }[]>`
      insert into schedules (start_date, end_date, status, created_by, published_at)
      values (${start}::date, ${end}::date, ${status}, ${manager.id},
        ${status === 'published' ? sql`now()` : null})
      returning id`;
    return r!.id;
  }

  async function insertShift(
    scheduleId: string,
    date: string,
    userId: string | null,
    hours = 14,
  ): Promise<string> {
    const [r] = await sql<{ id: string }[]>`
      insert into shifts (schedule_id, date, day_type, hours, user_id, original_user_id,
        original_hours)
      values (${scheduleId}, ${date}::date, 'weekday', ${hours}, ${userId}, ${userId}, ${hours})
      returning id`;
    return r!.id;
  }

  const owner = async (id: string) =>
    (await sql<{ user_id: string }[]>`select user_id from shifts where id = ${id}`)[0]!.user_id;
  const auditActions = async (entityId: string) =>
    (
      await sql<{ action: string }[]>`
        select action from audit_log where entity_id = ${entityId} order by occurred_at, id`
    ).map((r) => r.action);

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`truncate email_outbox, swaps, unavailabilities, shifts, schedules, sessions, users cascade`;
    manager = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
    ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
    bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });
    caio = await loginAs(sql, { email: 'caio@x.com', name: 'Caio' });
    events = [];
    hookFails = false;
    realHook = false;
    sched = await insertSchedule('2026-12-01', '2026-12-31', 'published');
    shift['ana1'] = await insertShift(sched, '2026-12-01', ana.id);
    shift['bia2'] = await insertShift(sched, '2026-12-02', bia.id);
    shift['ana3'] = await insertShift(sched, '2026-12-03', ana.id);
    shift['bia4'] = await insertShift(sched, '2026-12-04', bia.id);
    const past = await insertSchedule('2026-11-01', '2026-11-30', 'published');
    shift['anaPast'] = await insertShift(past, '2026-11-10', ana.id);
    shift['biaPast'] = await insertShift(past, '2026-11-11', bia.id);
    const draft = await insertSchedule('2027-01-01', '2027-01-31', 'draft');
    shift['anaDraft'] = await insertShift(draft, '2027-01-05', ana.id);
    shift['holiday'] = await insertShift(sched, '2026-12-25', null, 0);
  });

  const request = async (
    user: TestUser,
    body: object,
  ): Promise<{
    res: Response;
    json: { swap?: { id: string; status: string } } & Record<string, unknown>;
  }> => {
    const res = await call('POST', '/swaps', user, body);
    return { res, json: (await res.json()) as never };
  };
  const swapBody = () => ({
    kind: 'swap',
    shiftId: shift['ana1'],
    counterpartId: bia.id,
    counterpartShiftId: shift['bia2'],
  });
  const cessionBody = () => ({ kind: 'cession', shiftId: shift['ana1'], counterpartId: bia.id });
  const create = async (body: object = swapBody(), user = ana): Promise<string> => {
    const { res, json } = await request(user, body);
    expect(res.status).toBe(201);
    return json.swap!.id;
  };
  const act = (id: string, action: string, user: TestUser, body?: unknown) =>
    call('POST', `/swaps/${id}/${action}`, user, body);

  describe('solicitar', () => {
    it('cria permuta pendente, audita e dispara o hook', async () => {
      const { res, json } = await request(ana, { ...swapBody(), note: 'Consulta médica' });
      expect(res.status).toBe(201);
      expect(json.swap).toMatchObject({
        kind: 'swap',
        status: 'pending',
        requesterId: ana.id,
        counterpartId: bia.id,
        note: 'Consulta médica',
        requesterShift: { id: shift['ana1'], date: '2026-12-01', hours: 14 },
        counterpartShift: { id: shift['bia2'], date: '2026-12-02' },
      });
      expect(events.map((e) => e.type)).toEqual(['requested']);
      expect(events[0]!.actorId).toBe(ana.id);
      expect(await auditActions(json.swap!.id)).toEqual(['swap.create']);
    });

    it('cria cessão pendente', async () => {
      const { res, json } = await request(ana, cessionBody());
      expect(res.status).toBe(201);
      expect(json.swap).toMatchObject({ kind: 'cession', counterpartShift: null });
    });

    it('exige autenticação e valida o corpo', async () => {
      expect((await call('POST', '/swaps', null, cessionBody())).status).toBe(401);
      expect((await request(ana, { ...cessionBody(), kind: 'x' })).res.status).toBe(400);
      expect((await request(ana, { ...swapBody(), counterpartShiftId: null })).res.status).toBe(
        400,
      );
      expect(
        (await request(ana, { ...cessionBody(), counterpartShiftId: shift['bia2'] })).res.status,
      ).toBe(400);
    });

    it('recusa plantão que não é do solicitante, passado, de rascunho ou sem horas', async () => {
      const notMine = await request(ana, { ...cessionBody(), shiftId: shift['bia2'] });
      expect(notMine.res.status).toBe(422);
      expect(notMine.json['error']).toBe('shift_not_owned');
      const past = await request(ana, { ...cessionBody(), shiftId: shift['anaPast'] });
      expect(past.json['error']).toBe('shift_past');
      const draft = await request(ana, { ...cessionBody(), shiftId: shift['anaDraft'] });
      expect(draft.json['error']).toBe('shift_unavailable');
      const unknown = await request(ana, {
        ...cessionBody(),
        shiftId: '00000000-0000-4000-8000-000000000000',
      });
      expect(unknown.json['error']).toBe('shift_unavailable');
    });

    it('recusa plantão do colega que não é dele ou já passou', async () => {
      const wrong = await request(ana, { ...swapBody(), counterpartShiftId: shift['ana3'] });
      expect(wrong.json['error']).toBe('counterpart_shift_not_owned');
      const past = await request(ana, { ...swapBody(), counterpartShiftId: shift['biaPast'] });
      expect(past.json['error']).toBe('shift_past');
    });

    it('recusa troca consigo mesmo, colega inexistente ou inativo', async () => {
      expect((await request(ana, { ...cessionBody(), counterpartId: ana.id })).res.status).toBe(
        422,
      );
      const ghost = await request(ana, {
        ...cessionBody(),
        counterpartId: '00000000-0000-4000-8000-000000000000',
      });
      expect(ghost.res.status).toBe(404);
      await sql`update users set active = false where id = ${bia.id}`;
      expect((await request(ana, cessionBody())).json['error']).toBe('counterpart_inactive');
    });

    it('recusa por exceção do colega com mensagem genérica, sem revelar o tipo', async () => {
      await sql`
        insert into unavailabilities (user_id, kind, start_date, end_date, note, created_by)
        values (${bia.id}, 'time_off', '2026-11-30', '2026-12-01', 'Cirurgia sigilosa', ${bia.id})`;
      const { res, json } = await request(ana, cessionBody());
      expect(res.status).toBe(422);
      expect(json['error']).toBe('counterpart_unavailable');
      expect(json['message']).toBe('Colega indisponível nessa data');
      const raw = JSON.stringify(json).toLowerCase();
      for (const leak of ['time_off', 'folga', 'férias', 'cirurgia', 'sigilosa']) {
        expect(raw).not.toContain(leak);
      }
      const [{ n }] = await sql<{ n: string }[]>`select count(*)::text as n from swaps`;
      expect(n).toBe('0');
    });

    it('recusa por férias coletivas e por exceção do solicitante na data do colega', async () => {
      await sql`
        insert into unavailabilities (user_id, kind, start_date, end_date, created_by)
        values (null, 'collective_vacation', '2026-12-01', '2026-12-01', ${manager.id})`;
      expect((await request(ana, cessionBody())).json['error']).toBe('counterpart_unavailable');
      await sql`truncate unavailabilities`;
      await sql`
        insert into unavailabilities (user_id, kind, start_date, end_date, created_by)
        values (${ana.id}, 'vacation', '2026-12-02', '2026-12-02', ${ana.id})`;
      expect((await request(ana, swapBody())).json['error']).toBe('requester_unavailable');
    });

    it('impede solicitações abertas duplicadas para o mesmo plantão', async () => {
      await create(cessionBody());
      const dup = await request(ana, { ...cessionBody(), counterpartId: caio.id });
      expect(dup.res.status).toBe(409);
      const asCounterpart = await request(bia, {
        kind: 'cession',
        shiftId: shift['bia2'],
        counterpartId: caio.id,
      });
      expect(asCounterpart.res.status).toBe(201);
      const clash = await request(bia, {
        kind: 'swap',
        shiftId: shift['bia4'],
        counterpartId: ana.id,
        counterpartShiftId: shift['ana1'],
      });
      expect(clash.res.status).toBe(409);
    });

    it('permite nova solicitação depois de encerrada a anterior', async () => {
      const id = await create(cessionBody());
      expect((await act(id, 'decline', bia)).status).toBe(200);
      expect((await request(ana, cessionBody())).res.status).toBe(201);
    });
  });

  describe('aceitar, recusar e cancelar', () => {
    it('colega aceita: vai para aguardo de aprovação e escala não muda', async () => {
      const id = await create();
      const res = await act(id, 'accept', bia);
      expect(res.status).toBe(200);
      const { swap } = (await res.json()) as { swap: { status: string; respondedAt: string } };
      expect(swap.status).toBe('awaiting_approval');
      expect(swap.respondedAt).toBeTruthy();
      expect(await owner(shift['ana1']!)).toBe(ana.id);
      expect(events.map((e) => e.type)).toEqual(['requested', 'accepted']);
      expect(await auditActions(id)).toEqual(['swap.create', 'swap.accept']);
    });

    it('colega recusa: encerra com motivo opcional', async () => {
      const id = await create();
      const res = await act(id, 'decline', bia, { reason: 'Não consigo' });
      const { swap } = (await res.json()) as {
        swap: { status: string; decisionReason: string };
      };
      expect(swap).toMatchObject({ status: 'declined', decisionReason: 'Não consigo' });
      expect(events.at(-1)!.type).toBe('declined');
      expect(events.at(-1)!.reason).toBe('Não consigo');
      expect(await auditActions(id)).toContain('swap.decline');
    });

    it('só o colega aceita/recusa; só o solicitante cancela', async () => {
      const id = await create();
      expect((await act(id, 'accept', ana)).status).toBe(403);
      expect((await act(id, 'decline', ana)).status).toBe(403);
      expect((await act(id, 'accept', manager)).status).toBe(403);
      expect((await act(id, 'cancel', bia)).status).toBe(403);
      expect((await act(id, 'accept', caio)).status).toBe(404);
      expect((await act(id, 'approve', bia)).status).toBe(403);
    });

    it('solicitante cancela pendente e também aguardando aprovação', async () => {
      const a = await create(cessionBody());
      expect((await act(a, 'cancel', ana)).status).toBe(200);
      const b = await create(swapBody());
      await act(b, 'accept', bia);
      const res = await act(b, 'cancel', ana);
      expect(((await res.json()) as { swap: { status: string } }).swap.status).toBe('cancelled');
      expect(events.at(-1)!.type).toBe('cancelled');
      expect(await auditActions(b)).toContain('swap.cancel');
    });

    it('estados terminais e fora de ordem retornam 409', async () => {
      const id = await create();
      expect((await act(id, 'approve', manager)).status).toBe(409);
      expect((await act(id, 'reject', manager)).status).toBe(409);
      await act(id, 'decline', bia);
      expect((await act(id, 'accept', bia)).status).toBe(409);
      expect((await act(id, 'cancel', ana)).status).toBe(409);
    });

    it('aceite revalida: exceção criada depois recusa com mensagem genérica', async () => {
      const id = await create(cessionBody());
      await sql`
        insert into unavailabilities (user_id, kind, start_date, end_date, created_by)
        values (${bia.id}, 'other', '2026-12-01', '2026-12-01', ${bia.id})`;
      const res = await act(id, 'accept', bia);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { message: string }).message).toBe(
        'Colega indisponível nessa data',
      );
      expect((await act(id, 'decline', bia)).status).toBe(200);
    });
  });

  describe('aprovar e rejeitar', () => {
    it('aprova permuta: troca os dois plantões, mantém original_*, audita', async () => {
      const id = await create();
      await act(id, 'accept', bia);
      const res = await act(id, 'approve', manager);
      expect(res.status).toBe(200);
      const { swap } = (await res.json()) as {
        swap: { status: string; appliedAt: string; decidedBy: string };
      };
      expect(swap).toMatchObject({ status: 'approved', decidedBy: manager.id });
      expect(swap.appliedAt).toBeTruthy();
      expect(await owner(shift['ana1']!)).toBe(bia.id);
      expect(await owner(shift['bia2']!)).toBe(ana.id);
      const rows = await sql<{ original_user_id: string; original_hours: number }[]>`
        select original_user_id, original_hours from shifts
        where id in (${shift['ana1']!}, ${shift['bia2']!}) order by date`;
      expect(rows.map((r) => r.original_user_id)).toEqual([ana.id, bia.id]);
      expect(rows.map((r) => r.original_hours)).toEqual([14, 14]);
      expect(events.at(-1)!.type).toBe('approved');
      expect(await auditActions(id)).toEqual(['swap.create', 'swap.accept', 'swap.approve']);
      expect(await auditActions(shift['ana1']!)).toEqual(['schedule.published_shift_change']);
      expect(await auditActions(shift['bia2']!)).toEqual(['schedule.published_shift_change']);
    });

    it('aprova cessão: só o plantão do solicitante muda', async () => {
      const id = await create(cessionBody());
      await act(id, 'accept', bia);
      expect((await act(id, 'approve', manager)).status).toBe(200);
      expect(await owner(shift['ana1']!)).toBe(bia.id);
      expect(await owner(shift['bia2']!)).toBe(bia.id);
      const [s] = await sql<{ original_user_id: string }[]>`
        select original_user_id from shifts where id = ${shift['ana1']!}`;
      expect(s!.original_user_id).toBe(ana.id);
    });

    it('rejeita com motivo: encerra sem alterar a escala', async () => {
      const id = await create();
      await act(id, 'accept', bia);
      const res = await act(id, 'reject', manager, { reason: 'Cobertura insuficiente' });
      const { swap } = (await res.json()) as {
        swap: { status: string; decisionReason: string };
      };
      expect(swap).toMatchObject({ status: 'rejected', decisionReason: 'Cobertura insuficiente' });
      expect(await owner(shift['ana1']!)).toBe(ana.id);
      expect(events.at(-1)!.type).toBe('rejected');
      expect(await auditActions(id)).toContain('swap.reject');
    });

    it('revalida na aplicação: plantão reatribuído pelo gestor impede a troca', async () => {
      const id = await create();
      await act(id, 'accept', bia);
      await sql`update shifts set user_id = ${caio.id} where id = ${shift['ana1']!}`;
      const res = await act(id, 'approve', manager);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe('shift_unavailable');
      expect(await owner(shift['bia2']!)).toBe(bia.id);
      const [s] = await sql<{ status: string }[]>`select status from swaps where id = ${id}`;
      expect(s!.status).toBe('awaiting_approval');
      expect((await act(id, 'reject', manager)).status).toBe(200);
    });

    it('revalida na aplicação: plantão passado, colega inativo ou com exceção nova', async () => {
      const id = await create(cessionBody());
      await act(id, 'accept', bia);
      await sql`update users set active = false where id = ${bia.id}`;
      expect(((await (await act(id, 'approve', manager)).json()) as { error: string }).error).toBe(
        'counterpart_inactive',
      );
      await sql`update users set active = true where id = ${bia.id}`;
      await sql`
        insert into unavailabilities (user_id, kind, start_date, end_date, created_by)
        values (${bia.id}, 'vacation', '2026-12-01', '2026-12-01', ${bia.id})`;
      const res = await act(id, 'approve', manager);
      expect(((await res.json()) as { message: string }).message).toBe(
        'Colega indisponível nessa data',
      );
      expect(await owner(shift['ana1']!)).toBe(ana.id);
    });

    it('não aplica quando o plantão já começou (relógio avançou)', async () => {
      const id = await create(cessionBody());
      await act(id, 'accept', bia);
      const late = buildTestApp(sql, (a) =>
        a.route('/', createSwapsRouter({ db: sql, now: () => new Date('2026-12-01T03:00:00Z') })),
      );
      const res = await late.request(`/swaps/${id}/approve`, {
        method: 'POST',
        headers: { cookie: manager.cookie, ...csrfHeaders, origin: TEST_ORIGIN },
      });
      expect(res.status).toBe(422);
      expect(await owner(shift['ana1']!)).toBe(ana.id);
    });

    it('membro não aprova nem rejeita; erro no hook não desfaz a aprovação', async () => {
      const id = await create(cessionBody());
      await act(id, 'accept', bia);
      expect((await act(id, 'approve', ana)).status).toBe(403);
      expect((await act(id, 'reject', bia)).status).toBe(403);
      hookFails = true;
      expect((await act(id, 'approve', manager)).status).toBe(200);
      expect(await owner(shift['ana1']!)).toBe(bia.id);
    });
  });

  describe('notificação transacional (outbox)', () => {
    const outbox = async () =>
      sql<{ to_address: string; dedupe_key: string }[]>`
        select to_address, dedupe_key from email_outbox order by dedupe_key`;
    const statusOf = async (id: string) =>
      (await sql<{ status: string }[]>`select status from swaps where id = ${id}`)[0]!.status;

    it('sucesso grava a transição e o e-mail juntos', async () => {
      realHook = true;
      const id = await create(cessionBody());
      expect((await act(id, 'accept', bia)).status).toBe(200);
      expect(await statusOf(id)).toBe('awaiting_approval');
      const keys = (await outbox()).map((r) => r.dedupe_key);
      expect(keys).toContain(`swap-requested:${id}:counterpart`);
      expect(keys).toContain(`swap-accepted:${id}:requester`);
    });

    it('falha do gancho não desfaz a transição nem deixa e-mail parcial', async () => {
      const id = await create(cessionBody());
      hookFails = true;
      expect((await act(id, 'accept', bia)).status).toBe(200);
      expect(await statusOf(id)).toBe('awaiting_approval');
      expect(await outbox()).toHaveLength(0);
    });

    it('rollback da mutação não deixa e-mail na outbox', async () => {
      realHook = true;
      const id = await create(cessionBody());
      await sql`delete from email_outbox`;
      await sql`update shifts set user_id = ${caio.id} where id = ${shift['ana1']}`;
      // aceite revalida a viabilidade e falha: nada de e-mail
      expect((await act(id, 'accept', bia)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf(id)).toBe('pending');
      expect(await outbox()).toHaveLength(0);
    });
  });

  describe('consulta', () => {
    it('membro vê só as próprias/recebidas; gestor vê todas e filtra por status', async () => {
      const a = await create(cessionBody());
      const b = await create(
        { kind: 'cession', shiftId: shift['bia4'], counterpartId: caio.id },
        bia,
      );
      await act(b, 'decline', caio);
      const ids = async (u: TestUser, q = '') =>
        (
          (await (await call('GET', `/swaps${q}`, u)).json()) as { items: { id: string }[] }
        ).items.map((i) => i.id);
      expect(await ids(ana)).toEqual([a]);
      expect((await ids(bia)).sort()).toEqual([a, b].sort());
      expect(await ids(caio)).toEqual([b]);
      expect((await ids(manager)).sort()).toEqual([a, b].sort());
      expect(await ids(manager, '?status=declined')).toEqual([b]);
      expect(await ids(bia, '?status=pending')).toEqual([a]);
      expect((await call('GET', '/swaps?status=foo', manager)).status).toBe(400);
      expect((await call('GET', '/swaps', null)).status).toBe(401);
    });

    it('detalhe: partes e gestor veem; outros recebem 404', async () => {
      const id = await create(cessionBody());
      expect((await call('GET', `/swaps/${id}`, ana)).status).toBe(200);
      expect((await call('GET', `/swaps/${id}`, bia)).status).toBe(200);
      expect((await call('GET', `/swaps/${id}`, manager)).status).toBe(200);
      expect((await call('GET', `/swaps/${id}`, caio)).status).toBe(404);
      expect((await call('GET', '/swaps/nao-uuid', manager)).status).toBe(404);
    });
  });
});
