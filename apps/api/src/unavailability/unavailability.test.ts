import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createUnavailabilityRouter, listUnavailableByDate } from './index.js';
import type { ConflictChecker } from './types.js';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('unavailability (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let manager: TestUser;
  let ana: TestUser;
  let bia: TestUser;
  let calls: Array<{ userId: string | null; start: string; end: string }>;
  let conflicts: Array<{ date: string; userId: string }>;

  const stub: ConflictChecker = async (_sql, args) => {
    calls.push(args);
    return conflicts;
  };
  const app = () =>
    buildTestApp(sql, (a) =>
      a.route('/', createUnavailabilityRouter({ db: sql, conflictChecker: stub })),
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
    bia = await loginAs(sql, { email: 'bia@x.com' });
    calls = [];
    conflicts = [];
  });

  const mine = { kind: 'vacation', startDate: '2026-12-01', endDate: '2026-12-05', note: 'Viagem' };

  it('membro cria, lista, altera e exclui a própria exceção', async () => {
    const res = await call('POST', '/unavailabilities', ana, mine);
    expect(res.status).toBe(201);
    const { unavailability: u, warnings } = await res.json();
    expect(warnings).toEqual([]);
    expect(u).toMatchObject({
      userId: ana.id,
      kind: 'vacation',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      note: 'Viagem',
      createdBy: ana.id,
    });

    const list = await (await call('GET', '/unavailabilities', ana)).json();
    expect(list.items).toHaveLength(1);

    const patch = await call('PATCH', `/unavailabilities/${u.id}`, ana, {
      endDate: '2026-12-10',
      note: null,
      kind: 'time_off',
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).unavailability).toMatchObject({
      endDate: '2026-12-10',
      note: null,
      kind: 'time_off',
    });

    expect((await call('DELETE', `/unavailabilities/${u.id}`, ana)).status).toBe(204);
    expect((await (await call('GET', '/unavailabilities', ana)).json()).items).toEqual([]);
  });

  it('filtra por período (sobreposição)', async () => {
    await call('POST', '/unavailabilities', ana, mine);
    const inside = await (
      await call('GET', '/unavailabilities?from=2026-12-05&to=2026-12-20', ana)
    ).json();
    const outside = await (
      await call('GET', '/unavailabilities?from=2026-12-06&to=2026-12-20', ana)
    ).json();
    expect(inside.items).toHaveLength(1);
    expect(outside.items).toHaveLength(0);
  });

  it('privacidade: membro não vê nem altera exceções de outro, mas vê as coletivas', async () => {
    const other = await (await call('POST', '/unavailabilities', bia, mine)).json();
    const coll = await (
      await call('POST', '/unavailabilities', manager, {
        kind: 'collective_vacation',
        startDate: '2026-12-24',
        endDate: '2026-12-31',
        note: 'Recesso',
      })
    ).json();

    const list = await (await call('GET', '/unavailabilities', ana)).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([coll.unavailability.id]);
    expect(JSON.stringify(list)).not.toContain('Viagem');

    expect((await call('GET', `/unavailabilities?userId=${bia.id}`, ana)).status).toBe(403);
    const patch = await call('PATCH', `/unavailabilities/${other.unavailability.id}`, ana, {
      note: 'x',
    });
    expect(patch.status).toBe(404);
    expect((await call('DELETE', `/unavailabilities/${other.unavailability.id}`, ana)).status).toBe(
      404,
    );
    expect(
      (await call('PATCH', `/unavailabilities/${coll.unavailability.id}`, ana, { note: 'x' }))
        .status,
    ).toBe(403);
    expect((await call('DELETE', `/unavailabilities/${coll.unavailability.id}`, ana)).status).toBe(
      403,
    );
  });

  it('gestor vê todas, filtra por userId, cria para membro e coletiva com autoria', async () => {
    const forBia = await call('POST', '/unavailabilities', manager, {
      ...mine,
      userId: bia.id,
      kind: 'other',
    });
    expect(forBia.status).toBe(201);
    expect((await forBia.json()).unavailability).toMatchObject({
      userId: bia.id,
      createdBy: manager.id,
    });
    await call('POST', '/unavailabilities', ana, mine);
    const coll = await call('POST', '/unavailabilities', manager, {
      kind: 'collective_vacation',
      startDate: '2026-12-24',
      endDate: '2026-12-31',
    });
    expect(coll.status).toBe(201);
    expect((await coll.json()).unavailability).toMatchObject({
      userId: null,
      createdBy: manager.id,
    });

    expect((await (await call('GET', '/unavailabilities', manager)).json()).items).toHaveLength(3);
    const only = await (await call('GET', `/unavailabilities?userId=${bia.id}`, manager)).json();
    expect(only.items).toHaveLength(1);
  });

  it('gestor altera e exclui exceção de membro e coletiva', async () => {
    const u = (await (await call('POST', '/unavailabilities', ana, mine)).json()).unavailability;
    expect((await call('PATCH', `/unavailabilities/${u.id}`, manager, { note: 'ok' })).status).toBe(
      200,
    );
    expect((await call('DELETE', `/unavailabilities/${u.id}`, manager)).status).toBe(204);
    const c = (
      await (
        await call('POST', '/unavailabilities', manager, {
          kind: 'collective_vacation',
          startDate: '2026-12-24',
          endDate: '2026-12-31',
        })
      ).json()
    ).unavailability;
    expect(
      (await call('PATCH', `/unavailabilities/${c.id}`, manager, { kind: 'other' })).status,
    ).toBe(400);
    expect((await call('DELETE', `/unavailabilities/${c.id}`, manager)).status).toBe(204);
  });

  it('401 sem sessão e 403 em ações de gestor feitas por membro', async () => {
    expect((await call('GET', '/unavailabilities', null)).status).toBe(401);
    expect((await call('POST', '/unavailabilities', null, mine)).status).toBe(401);
    expect(
      (
        await call('POST', '/unavailabilities', ana, {
          kind: 'collective_vacation',
          startDate: '2026-12-24',
          endDate: '2026-12-31',
        })
      ).status,
    ).toBe(403);
    expect((await call('POST', '/unavailabilities', ana, { ...mine, userId: bia.id })).status).toBe(
      403,
    );
  });

  it('valida entrada (400)', async () => {
    const bad = async (body: unknown) => {
      const res = await call('POST', '/unavailabilities', ana, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_error');
    };
    await bad({ ...mine, startDate: '2026-12-10', endDate: '2026-12-09' });
    await bad({ ...mine, startDate: '2026-02-30' });
    await bad({ ...mine, startDate: '01/12/2026' });
    await bad({ ...mine, kind: 'sick' });
    await bad({ ...mine, note: 'a'.repeat(501) });
    await bad({});
    expect(
      (await call('POST', '/unavailabilities', ana, { ...mine, note: 'a'.repeat(500) })).status,
    ).toBe(201);
    expect(
      (
        await call('POST', '/unavailabilities', manager, {
          ...mine,
          kind: 'collective_vacation',
          userId: ana.id,
        })
      ).status,
    ).toBe(400);
    expect((await call('GET', '/unavailabilities?from=2026-12-10&to=2026-12-01', ana)).status).toBe(
      400,
    );

    const u = (await (await call('POST', '/unavailabilities', ana, mine)).json()).unavailability;
    expect(
      (await call('PATCH', `/unavailabilities/${u.id}`, ana, { endDate: '2026-11-01' })).status,
    ).toBe(400);
    expect(
      (await call('PATCH', `/unavailabilities/${u.id}`, ana, { kind: 'collective_vacation' }))
        .status,
    ).toBe(400);
    expect((await call('PATCH', '/unavailabilities/nao-e-uuid', ana, { note: 'x' })).status).toBe(
      404,
    );
  });

  it('usuário alvo inexistente ou inativo', async () => {
    const inactive = await loginAs(sql, { email: 'off@x.com', active: false });
    const none = await call('POST', '/unavailabilities', manager, {
      ...mine,
      userId: '99999999-9999-4999-8999-999999999999',
    });
    expect(none.status).toBe(404);
    expect((await none.json()).error).toBe('user_not_found');
    const off = await call('POST', '/unavailabilities', manager, { ...mine, userId: inactive.id });
    expect(off.status).toBe(400);
    expect((await off.json()).error).toBe('user_inactive');
  });

  it('avisa conflito com plantão publicado na criação e alteração', async () => {
    conflicts = [{ date: '2026-12-02', userId: ana.id }];
    const res = await call('POST', '/unavailabilities', ana, mine);
    expect((await res.json()).warnings).toEqual([
      { type: 'published_shift_conflict', date: '2026-12-02', userId: ana.id },
    ]);
    expect(calls[0]).toEqual({ userId: ana.id, start: '2026-12-01', end: '2026-12-05' });

    const u = (await (await call('POST', '/unavailabilities', ana, mine)).json()).unavailability;
    const patch = await call('PATCH', `/unavailabilities/${u.id}`, ana, { endDate: '2026-12-06' });
    expect((await patch.json()).warnings).toHaveLength(1);
    expect(calls.at(-1)).toEqual({ userId: ana.id, start: '2026-12-01', end: '2026-12-06' });

    await call('POST', '/unavailabilities', manager, {
      kind: 'collective_vacation',
      startDate: '2026-12-24',
      endDate: '2026-12-31',
    });
    expect(calls.at(-1)).toEqual({ userId: null, start: '2026-12-24', end: '2026-12-31' });
  });

  it('sem conflictChecker, warnings vem vazio', async () => {
    const plain = buildTestApp(sql, (a) => a.route('/', createUnavailabilityRouter({ db: sql })));
    const res = await plain.request('/unavailabilities', {
      method: 'POST',
      headers: {
        cookie: ana.cookie,
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(mine),
    });
    expect((await res.json()).warnings).toEqual([]);
  });

  it('registra auditoria na mesma transação (create/update/delete)', async () => {
    const u = (await (await call('POST', '/unavailabilities', ana, mine)).json()).unavailability;
    await call('PATCH', `/unavailabilities/${u.id}`, ana, { note: 'novo' });
    await call('DELETE', `/unavailabilities/${u.id}`, ana);
    const rows = await sql<
      {
        action: string;
        actor_id: string;
        before: { note: string } | null;
        after: { note: string } | null;
      }[]
    >`select action, actor_id, before, after from audit_log
      where entity_type = 'unavailability' and entity_id = ${u.id} order by id`;
    expect(rows.map((r) => r.action)).toEqual([
      'unavailability.create',
      'unavailability.update',
      'unavailability.delete',
    ]);
    expect(rows[0]!.after?.note).toBe('Viagem');
    expect(rows[1]!.before?.note).toBe('Viagem');
    expect(rows[1]!.after?.note).toBe('novo');
    expect(rows[2]!.before?.note).toBe('novo');
    expect(rows.every((r) => r.actor_id === ana.id)).toBe(true);
  });

  it('exige CSRF em métodos não seguros', async () => {
    const res = await app().request('/unavailabilities', {
      method: 'POST',
      headers: { cookie: ana.cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(mine),
    });
    expect(res.status).toBe(403);
    expect((await sql`select 1 from unavailabilities`).length).toBe(0);
  });

  it('listUnavailableByDate devolve bloqueios por data e férias coletivas recortados', async () => {
    await call('POST', '/unavailabilities', ana, {
      kind: 'vacation',
      startDate: '2026-11-28',
      endDate: '2026-12-02',
    });
    await call('POST', '/unavailabilities', ana, {
      kind: 'other',
      startDate: '2026-12-02',
      endDate: '2026-12-03',
    });
    await call('POST', '/unavailabilities', bia, {
      kind: 'time_off',
      startDate: '2026-12-10',
      endDate: '2026-12-10',
    });
    await call('POST', '/unavailabilities', bia, {
      kind: 'time_off',
      startDate: '2027-01-10',
      endDate: '2027-01-10',
    });
    await call('POST', '/unavailabilities', manager, {
      kind: 'collective_vacation',
      startDate: '2026-12-28',
      endDate: '2027-01-05',
    });

    const r = await listUnavailableByDate(sql, '2026-12-01', '2026-12-31');
    expect(r.collectiveVacations).toEqual([{ start: '2026-12-28', end: '2026-12-31' }]);
    expect(r.byUser.get(ana.id)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    expect(r.byUser.get(bia.id)).toEqual(['2026-12-10']);
    expect(r.byUser.has(manager.id)).toBe(false);
  });

  it('constraints do banco: coletiva exige user_id nulo e período válido', async () => {
    await expect(
      sql`insert into unavailabilities (user_id, kind, start_date, end_date)
        values (${ana.id}, 'collective_vacation', '2026-12-01', '2026-12-02')`,
    ).rejects.toThrow();
    await expect(
      sql`insert into unavailabilities (user_id, kind, start_date, end_date)
        values (null, 'vacation', '2026-12-01', '2026-12-02')`,
    ).rejects.toThrow();
    await expect(
      sql`insert into unavailabilities (user_id, kind, start_date, end_date)
        values (${ana.id}, 'vacation', '2026-12-02', '2026-12-01')`,
    ).rejects.toThrow();
  });
});
