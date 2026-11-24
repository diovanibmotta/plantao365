import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createUsersRouter } from './router.js';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('users module (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;
  let appWithShifts: ReturnType<typeof buildTestApp>;

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) => a.route('/', createUsersRouter({ db: sql })));
    appWithShifts = buildTestApp(sql, (a) =>
      a.route(
        '/',
        createUsersRouter({
          db: sql,
          now: () => new Date('2026-06-10T15:00:00Z'),
          futureShiftsFinder: async (tx, q) => {
            const rows = await tx<{ date: string; user_id: string }[]>`
              select s.date::text as date, s.user_id from shifts s
              join schedules sc on sc.id = s.schedule_id
              where sc.status = 'published' and s.user_id = ${q.userId}
                and s.date between ${q.start}::date and ${q.end}::date`;
            return rows.map((r) => ({ date: r.date, userId: r.user_id }));
          },
        }),
      ),
    );
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`delete from sessions`;
    await sql`delete from schedules`;
    await sql`delete from users`;
    await sql`alter table audit_log disable trigger audit_log_no_truncate`;
    await sql`truncate audit_log`;
    await sql`alter table audit_log enable trigger audit_log_no_truncate`;
  });

  const call = (method: string, path: string, cookie?: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method === 'GET' ? {} : csrfHeaders),
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const auditFor = (entityId: string) =>
    sql<{ action: string; actor_id: string; before: unknown; after: Record<string, unknown> }[]>`
      select action, actor_id, before, after from audit_log
      where entity_type = 'user' and entity_id = ${entityId} order by id`;

  describe('/me', () => {
    it('returns the profile of the logged user', async () => {
      const u = await loginAs(sql, { email: 'a@x.com', name: 'Ana' });
      const res = await call('GET', '/me', u.cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: u.id,
        name: 'Ana',
        email: 'a@x.com',
        phone: null,
        role: 'member',
        active: true,
        participatesInRotation: true,
        remindersEnabled: true,
      });
    });

    it('requires a session', async () => {
      expect((await call('GET', '/me')).status).toBe(401);
      expect((await call('PATCH', '/me', undefined, { phone: '11999998888' })).status).toBe(401);
    });

    it('updates phone and reminders and audits it', async () => {
      const u = await loginAs(sql, { email: 'a@x.com' });
      const res = await call('PATCH', '/me', u.cookie, {
        phone: '+55 (11) 99999-8888',
        remindersEnabled: false,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        phone: '+55 (11) 99999-8888',
        remindersEnabled: false,
      });
      const audit = await auditFor(u.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'update', actor_id: u.id });
      expect(audit[0]!.after).toMatchObject({ phone: '+55 (11) 99999-8888' });

      const cleared = await call('PATCH', '/me', u.cookie, { phone: null });
      expect(await cleared.json()).toMatchObject({ phone: null, remindersEnabled: false });
    });

    it.each(['name', 'email', 'role', 'active', 'participatesInRotation'])(
      'rejects changing protected field %s',
      async (field) => {
        const u = await loginAs(sql, { email: 'a@x.com' });
        const res = await call('PATCH', '/me', u.cookie, { [field]: 'x', remindersEnabled: true });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; message: string };
        expect(body.error).toBe('protected_field');
        expect(body.message).toContain(field);
        expect(await auditFor(u.id)).toHaveLength(0);
      },
    );

    it('rejects invalid phone, wrong types and empty body', async () => {
      const u = await loginAs(sql, { email: 'a@x.com' });
      for (const body of [
        { phone: 'abc' },
        { phone: '123' },
        { remindersEnabled: 'sim' },
        {},
        { other: 1 },
      ]) {
        expect((await call('PATCH', '/me', u.cookie, body)).status).toBe(400);
      }
    });
  });

  describe('manager routes', () => {
    it('forbids members and anonymous users', async () => {
      const m = await loginAs(sql, { email: 'm@x.com' });
      expect((await call('GET', '/users', m.cookie)).status).toBe(403);
      expect((await call('POST', '/users', m.cookie, { name: 'N', email: 'n@x.com' })).status).toBe(
        403,
      );
      expect((await call('PATCH', `/users/${m.id}`, m.cookie, { name: 'Z' })).status).toBe(403);
      expect((await call('GET', '/users')).status).toBe(401);
    });

    it('lists users with linked flag', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
      await sql`update users set oid = 'oid-1' where id = ${g.id}`;
      await call('POST', '/users', g.cookie, { name: 'Bia', email: 'bia@x.com' });
      const res = await call('GET', '/users', g.cookie);
      expect(res.status).toBe(200);
      const list = (await res.json()) as { email: string; linked: boolean; createdAt: string }[];
      expect(list.map((u) => [u.email, u.linked])).toEqual([
        ['bia@x.com', false],
        ['g@x.com', true],
      ]);
      expect(new Date(list[0]!.createdAt).toISOString()).toBe(list[0]!.createdAt);
    });

    it('pre-registers only name and e-mail, without joining any team', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const member = await call('POST', '/users', g.cookie, {
        name: ' Bia ',
        email: '  Bia@X.com ',
      });
      expect(member.status).toBe(201);
      expect(await member.json()).toMatchObject({
        name: 'Bia',
        email: 'bia@x.com',
        active: true,
        linked: false,
        teamIds: [],
      });
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from team_members m join users u on u.id = m.user_id
        where u.email = 'bia@x.com'`;
      expect(n).toBe(0);

      const [row] = await sql<{ id: string }[]>`select id from users where email = 'bia@x.com'`;
      const audit = await auditFor(row!.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'create', actor_id: g.id });
    });

    it('links the pre-registered user to teams before first access, already as member/manager', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const [team] = await sql<{ id: string }[]>`select team_id as id from team_members
        where user_id = ${g.id}`;
      const res = await call('POST', '/users', g.cookie, {
        name: 'Bia',
        email: 'bia@x.com',
        teams: [{ teamId: team!.id, role: 'manager', participatesInRotation: false }],
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ linked: false, teamIds: [team!.id] });
      const [link] = await sql<{ role: string; p: boolean; urole: string }[]>`
        select m.role, m.participates_in_rotation as p, u.role as urole
        from team_members m join users u on u.id = m.user_id where u.email = 'bia@x.com'`;
      expect(link).toEqual({ role: 'manager', p: false, urole: 'manager' });
    });

    it('rolls back the registration when a team is not manageable by the actor', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const [other] = await sql<{ id: string }[]>`
        insert into teams (name) values ('Outra') returning id`;
      const res = await call('POST', '/users', g.cookie, {
        name: 'Bia',
        email: 'bia@x.com',
        teams: [{ teamId: other!.id }],
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe('team_not_found');
      const rows = await sql`select 1 from users where email = 'bia@x.com'`;
      expect(rows).toHaveLength(0);
    });

    it('rejects duplicated or malformed teams', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const id = '00000000-0000-0000-0000-000000000001';
      for (const teams of [[{ teamId: id }, { teamId: id }], [{ teamId: 'x' }]]) {
        const res = await call('POST', '/users', g.cookie, {
          name: 'Bia',
          email: 'bia@x.com',
          teams,
        });
        expect(res.status).toBe(400);
      }
    });

    it('rejects duplicates (case-insensitive) and invalid input', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const dup = await call('POST', '/users', g.cookie, { name: 'X', email: 'G@X.com' });
      expect(dup.status).toBe(409);
      expect(((await dup.json()) as { error: string }).error).toBe('email_in_use');
      for (const body of [
        { name: 'X', email: 'nao-e-email' },
        { name: '', email: 'a@x.com' },
        { email: 'a@x.com' },
        { name: 'X', email: 'a@x.com', role: 'manager' },
        { name: 'X', email: 'a@x.com', participatesInRotation: true },
        { name: 'X', email: 'a@x.com', active: false },
      ]) {
        expect((await call('POST', '/users', g.cookie, body)).status).toBe(400);
      }
    });

    it('enqueues an invite e-mail when a user is created', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      await sql`delete from email_outbox`;
      await call('POST', '/users', g.cookie, { name: 'Bia', email: 'bia@x.com' });
      const rows = await sql<{ to_address: string; subject: string }[]>`
        select to_address, subject from email_outbox`;
      expect(rows).toEqual([
        { to_address: 'bia@x.com', subject: 'Você foi convidado para o Plantão365' },
      ]);
    });

    it('lists all users including pre-registered ones and hides the master user', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      await call('POST', '/users', g.cookie, { name: 'Visita', email: 'visita@x.com' });
      const [master] = await sql<{ id: string }[]>`
        insert into users (email, name, role, is_master, participates_in_rotation)
        values ('master@plantao365.invalid', 'root', 'manager', true, false) returning id`;
      const list = (await (await call('GET', '/users', g.cookie)).json()) as {
        id: string;
        email: string;
      }[];
      expect(list.map((u) => u.email)).toEqual(['g@x.com', 'visita@x.com']);
      expect(list.map((u) => u.id)).not.toContain(master!.id);
      const patch = await call('PATCH', `/users/${master!.id}`, g.cookie, { active: false });
      expect(patch.status).toBe(404);
    });

    it('requires CSRF header on POST', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const res = await app.request('/users', {
        method: 'POST',
        headers: { cookie: g.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X', email: 'x@x.com' }),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('csrf');
    });

    it('updates name and active with audit', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      const res = await call('PATCH', `/users/${m.id}`, g.cookie, { name: 'Maria' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ name: 'Maria', active: true });
      const off = await call('PATCH', `/users/${m.id}`, g.cookie, { active: false });
      expect(await off.json()).toMatchObject({ active: false });
      const on = await call('PATCH', `/users/${m.id}`, g.cookie, { active: true });
      expect(await on.json()).toMatchObject({ active: true });

      const audit = await auditFor(m.id);
      expect(audit).toHaveLength(3);
      expect(audit[0]).toMatchObject({ actor_id: g.id, action: 'update' });
      expect(audit[0]!.before).toMatchObject({ name: 'Fulano' });
      expect(audit[0]!.after).toMatchObject({ name: 'Maria' });
    });

    it('rejects role and rotation in the user body (they belong to the team)', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      for (const body of [{ role: 'manager' }, { participatesInRotation: false }]) {
        expect((await call('PATCH', `/users/${m.id}`, g.cookie, body)).status).toBe(400);
      }
    });

    it('returns 404 for unknown id and 400 for empty or invalid body', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      expect(
        (
          await call('PATCH', '/users/00000000-0000-4000-8000-000000000000', g.cookie, {
            name: 'A',
          })
        ).status,
      ).toBe(404);
      expect((await call('PATCH', '/users/abc', g.cookie, { name: 'A' })).status).toBe(404);
      expect((await call('PATCH', `/users/${g.id}`, g.cookie, {})).status).toBe(400);
      expect((await call('PATCH', `/users/${g.id}`, g.cookie, { email: 'z@x.com' })).status).toBe(
        400,
      );
    });

    it('deactivating deletes the user sessions', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      expect((await call('GET', '/me', m.cookie)).status).toBe(200);
      await call('PATCH', `/users/${m.id}`, g.cookie, { active: false });
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions where user_id = ${m.id}`;
      expect(n).toBe(0);
      expect((await call('GET', '/me', m.cookie)).status).toBe(401);
    });

    it('protects the last active manager of a team from deactivation', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const res = await call('PATCH', `/users/${g.id}`, g.cookie, { active: false });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe('last_manager');
      expect(await auditFor(g.id)).toHaveLength(0);

      const ok = await call('PATCH', `/users/${g.id}`, g.cookie, { name: 'Novo nome' });
      expect(ok.status).toBe(200);
    });

    it('allows deactivating a manager when another active one exists', async () => {
      const g1 = await loginAs(sql, { email: 'g1@x.com', role: 'manager' });
      const g2 = await loginAs(sql, { email: 'g2@x.com', role: 'manager' });
      expect((await call('PATCH', `/users/${g1.id}`, g2.cookie, { active: false })).status).toBe(
        200,
      );
    });
  });

  describe('desativação com plantões futuros publicados (Req 3.2)', () => {
    const call2 = (method: string, path: string, cookie: string, body?: unknown) =>
      appWithShifts.request(path, {
        method,
        headers: {
          cookie,
          ...(method === 'GET' ? {} : csrfHeaders),
          origin: TEST_ORIGIN,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    const seed = async (managerId: string, status: 'draft' | 'published', memberId: string) => {
      const [sc] = await sql<{ id: string }[]>`
        insert into schedules (start_date, end_date, status, created_by)
        values ('2026-06-01', '2026-06-30', ${status}, ${managerId}) returning id`;
      for (const [date, hours] of [
        ['2026-06-05', 14],
        ['2026-06-20', 24],
        ['2026-06-25', 14],
      ] as const) {
        await sql`
          insert into shifts (schedule_id, date, day_type, hours, user_id)
          values (${sc!.id}, ${date}, 'weekday', ${hours}, ${memberId})`;
      }
      return sc!.id;
    };

    it('blocks with 409 listing only future published shifts, until reassigned', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      const other = await loginAs(sql, { email: 'o@x.com' });
      const scheduleId = await seed(g.id, 'published', m.id);

      const res = await call2('PATCH', `/users/${m.id}`, g.cookie, { active: false });
      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        error: string;
        shifts: { date: string; scheduleId: string; scheduleStart: string }[];
      };
      expect(body.error).toBe('has_future_published_shifts');
      expect(body.shifts.map((x) => x.date)).toEqual(['2026-06-20', '2026-06-25']);
      expect(body.shifts[0]).toMatchObject({ scheduleId, scheduleStart: '2026-06-01' });
      const [{ active }] = await sql<
        { active: boolean }[]
      >`select active from users where id = ${m.id}`;
      expect(active).toBe(true);

      const list = await call2('GET', `/users/${m.id}/future-shifts`, g.cookie);
      expect(list.status).toBe(200);
      expect(((await list.json()) as { shifts: unknown[] }).shifts).toHaveLength(2);

      await sql`update shifts set user_id = ${other.id} where user_id = ${m.id} and date >= '2026-06-10'`;
      const ok = await call2('PATCH', `/users/${m.id}`, g.cookie, { active: false });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ active: false });
    });

    it('ignores draft schedules', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      await seed(g.id, 'draft', m.id);
      const res = await call2('PATCH', `/users/${m.id}`, g.cookie, { active: false });
      expect(res.status).toBe(200);
    });

    it('does not block other updates and restricts future-shifts to managers', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      await seed(g.id, 'published', m.id);
      const r = await call2('PATCH', `/users/${m.id}`, g.cookie, { name: 'Novo' });
      expect(r.status).toBe(200);
      expect((await call2('GET', `/users/${m.id}/future-shifts`, m.cookie)).status).toBe(403);
      const nf = await call2(
        'GET',
        '/users/00000000-0000-4000-8000-000000000000/future-shifts',
        g.cookie,
      );
      expect(nf.status).toBe(404);
    });

    it('lists colleagues (active, in rotation, not me) for any member', async () => {
      const me = await loginAs(sql, { email: 'me@x.com', name: 'Eu' });
      await loginAs(sql, { email: 'a@x.com', name: 'Ana' });
      await loginAs(sql, { email: 'i@x.com', name: 'Inativo', active: false });
      await loginAs(sql, { email: 'g@x.com', name: 'Gestor', participatesInRotation: false });
      const res = await call2('GET', '/users/colleagues', me.cookie);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Array<{ name: string }>).map((u) => u.name)).toEqual(['Ana']);
      expect((await call2('GET', '/users/colleagues', '')).status).toBe(401);
    });

    it('serves a colleague photo to any member, 404 when absent', async () => {
      const me = await loginAs(sql, { email: 'foto-me@x.com' });
      const other = await loginAs(sql, { email: 'foto-a@x.com' });
      await sql`update users set photo = ${Buffer.from([7, 8])}, photo_type = 'image/png'
        where id = ${other.id}`;
      const res = await call2('GET', `/users/${other.id}/photo`, me.cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([7, 8]);
      expect((await call2('GET', `/users/${me.id}/photo`, me.cookie)).status).toBe(404);
      expect((await call2('GET', '/users/nope/photo', me.cookie)).status).toBe(404);
      expect((await call2('GET', `/users/${other.id}/photo`, '')).status).toBe(401);
    });
  });
});
