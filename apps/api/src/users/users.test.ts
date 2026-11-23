import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createUsersRouter } from './router.js';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('users module (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let app: ReturnType<typeof buildTestApp>;

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    app = buildTestApp(sql, (a) => a.route('/', createUsersRouter({ db: sql })));
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`delete from sessions`;
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

    it('pre-registers with role-based defaults and normalized e-mail', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const member = await call('POST', '/users', g.cookie, {
        name: ' Bia ',
        email: '  Bia@X.com ',
      });
      expect(member.status).toBe(201);
      expect(await member.json()).toMatchObject({
        name: 'Bia',
        email: 'bia@x.com',
        role: 'member',
        participatesInRotation: true,
        active: true,
        linked: false,
      });
      const mgr = await call('POST', '/users', g.cookie, {
        name: 'Gil',
        email: 'gil@x.com',
        role: 'manager',
      });
      expect(await mgr.json()).toMatchObject({ role: 'manager', participatesInRotation: false });
      const explicit = await call('POST', '/users', g.cookie, {
        name: 'Gal',
        email: 'gal@x.com',
        role: 'manager',
        participatesInRotation: true,
      });
      expect(await explicit.json()).toMatchObject({ participatesInRotation: true });

      const [row] = await sql<{ id: string }[]>`select id from users where email = 'bia@x.com'`;
      const audit = await auditFor(row!.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'create', actor_id: g.id });
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
        { name: 'X', email: 'a@x.com', role: 'admin' },
        { name: 'X', email: 'a@x.com', active: false },
      ]) {
        expect((await call('POST', '/users', g.cookie, body)).status).toBe(400);
      }
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

    it('updates name, role, rotation flag and active with audit', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      const res = await call('PATCH', `/users/${m.id}`, g.cookie, {
        name: 'Maria',
        role: 'manager',
        participatesInRotation: false,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        name: 'Maria',
        role: 'manager',
        participatesInRotation: false,
      });
      const off = await call('PATCH', `/users/${m.id}`, g.cookie, { active: false });
      expect(await off.json()).toMatchObject({ active: false });
      const on = await call('PATCH', `/users/${m.id}`, g.cookie, { active: true, role: 'member' });
      expect(await on.json()).toMatchObject({ active: true, role: 'member' });

      const audit = await auditFor(m.id);
      expect(audit).toHaveLength(3);
      expect(audit[0]).toMatchObject({ actor_id: g.id, action: 'update' });
      expect(audit[0]!.before).toMatchObject({ name: 'Fulano', role: 'member' });
      expect(audit[0]!.after).toMatchObject({ name: 'Maria', role: 'manager' });
    });

    it('applies a role change on the next request', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const m = await loginAs(sql, { email: 'm@x.com' });
      expect((await call('GET', '/users', m.cookie)).status).toBe(403);
      await call('PATCH', `/users/${m.id}`, g.cookie, { role: 'manager' });
      expect((await call('GET', '/users', m.cookie)).status).toBe(200);
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

    it('protects the last active manager', async () => {
      const g = await loginAs(sql, { email: 'g@x.com', role: 'manager' });
      const inactive = await loginAs(sql, { email: 'i@x.com', role: 'manager', active: false });

      for (const body of [{ role: 'member' }, { active: false }]) {
        const res = await call('PATCH', `/users/${g.id}`, g.cookie, body);
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: string }).error).toBe('last_manager');
      }
      expect(await auditFor(g.id)).toHaveLength(0);

      const ok = await call('PATCH', `/users/${g.id}`, g.cookie, { name: 'Novo nome' });
      expect(ok.status).toBe(200);

      const other = await call('PATCH', `/users/${inactive.id}`, g.cookie, { role: 'member' });
      expect(other.status).toBe(200);
    });

    it('allows demoting a manager when another active one exists', async () => {
      const g1 = await loginAs(sql, { email: 'g1@x.com', role: 'manager' });
      const g2 = await loginAs(sql, { email: 'g2@x.com', role: 'manager' });
      const res = await call('PATCH', `/users/${g1.id}`, g2.cookie, { role: 'member' });
      expect(res.status).toBe(200);
      const last = await call('PATCH', `/users/${g2.id}`, g2.cookie, { active: false });
      expect(last.status).toBe(409);
    });

    it('never leaves zero active managers under concurrent demotions', async () => {
      for (let round = 0; round < 5; round++) {
        await sql`delete from sessions`;
        await sql`delete from users`;
        const g1 = await loginAs(sql, { email: 'g1@x.com', role: 'manager' });
        const g2 = await loginAs(sql, { email: 'g2@x.com', role: 'manager' });
        const results = await Promise.all([
          call('PATCH', `/users/${g2.id}`, g1.cookie, { role: 'member' }),
          call('PATCH', `/users/${g1.id}`, g2.cookie, { role: 'member' }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        const [{ n }] = await sql<{ n: number }[]>`
          select count(*)::int as n from users where role = 'manager' and active`;
        expect(n).toBe(1);
      }
    });
  });
});
