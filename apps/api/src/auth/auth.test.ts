import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';
import { bootstrapManagers } from './bootstrap.js';
import { MASTER_EMAIL, syncMasterUser } from './master.js';
import { sessionMiddleware } from './middleware.js';
import {
  claimsToIdentity,
  createEntraProvider,
  fetchGraphPhoto,
  OidcError,
  pkceChallenge,
  type OidcExpected,
  type OidcIdentity,
  type OidcProvider,
} from './oidc.js';
import { createAuthRouter, STATE_COOKIE } from './router.js';
import { SESSION_COOKIE } from './sessions.js';
import type { AuthEnv, AuthOptions } from './types.js';

const options: AuthOptions = {
  appBaseUrl: 'http://localhost:5173',
  cookieSecure: false,
  sessionTtlSeconds: 3600,
  oidc: { mock: true },
};
const logger = createLogger({ level: 'silent' });

function cookiesOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair!.indexOf('=');
    out[pair!.slice(0, i)] = pair!.slice(i + 1);
  }
  return out;
}

const cookieHeader = (c: Record<string, string>) =>
  Object.entries(c)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

describe.skipIf(!TEST_DATABASE_URL)('auth', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await t.sql`delete from sessions`;
    await t.sql`delete from oidc_login_states`;
    await t.sql`delete from users`;
  });

  const addUser = (email: string, extra: { active?: boolean; oid?: string; role?: string } = {}) =>
    t.sql`insert into users (email, name, role, active, oid)
      values (${email}, 'Fulano', ${extra.role ?? 'member'}, ${extra.active ?? true}, ${extra.oid ?? null})`;

  function buildApp(provider?: OidcProvider, opts: AuthOptions = options) {
    const app = new Hono();
    app.route(
      '/',
      createAuthRouter({ db: t.sql, logger, options: opts, ...(provider && { provider }) }),
    );
    const guarded = new Hono<AuthEnv>();
    guarded.use(sessionMiddleware({ db: t.sql, cookieOptions: { secure: opts.cookieSecure } }));
    guarded.get('/whoami', (c) => c.json(c.get('user')));
    app.route('/', guarded);
    return app;
  }

  async function startLogin(app: Hono) {
    const res = await app.request('/auth/login');
    const cookies = cookiesOf(res);
    return { res, cookies, state: cookies[STATE_COOKIE]! };
  }

  async function mockLogin(app: Hono, email: string) {
    const { cookies, state } = await startLogin(app);
    const res = await app.request(
      `/auth/callback?state=${state}&email=${encodeURIComponent(email)}`,
      { headers: { cookie: cookieHeader(cookies) } },
    );
    return res;
  }

  it('mock login creates a session for a registered active user', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const login = await app.request('/auth/login');
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('name="email"');

    const res = await mockLogin(app, 'Ana@Example.com');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(options.appBaseUrl);
    const setCookie = res.headers.getSetCookie().find((l) => l.startsWith(`${SESSION_COOKIE}=`))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);

    const token = cookiesOf(res)[SESSION_COOKIE]!;
    const stored = await t.sql<{ id: string }[]>`select id from sessions`;
    expect(stored[0]!.id).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored[0]!.id).not.toBe(token);

    const me = await app.request('/auth/me', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: 'ana@example.com', role: 'member' });
  });

  it('marks the session cookie Secure when configured', async () => {
    await addUser('ana@example.com');
    const app = buildApp(undefined, { ...options, cookieSecure: true });
    const res = await mockLogin(app, 'ana@example.com');
    const setCookie = res.headers.getSetCookie().find((l) => l.startsWith(`${SESSION_COOKIE}=`))!;
    expect(setCookie).toMatch(/Secure/);
  });

  it('GET /auth/me returns 401 without session', async () => {
    const res = await buildApp().request('/auth/me');
    expect(res.status).toBe(401);
  });

  it('logs an uninvited email in as a read-only guest and audits it', async () => {
    const app = buildApp();
    const res = await mockLogin(app, 'Ninguem@Example.com');
    expect(res.status).toBe(302);
    const token = cookiesOf(res)[SESSION_COOKIE]!;
    const me = await app.request('/auth/me', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(await me.json()).toMatchObject({
      email: 'ninguem@example.com',
      role: 'guest',
      participatesInRotation: false,
      isMaster: false,
    });
    const audit = await t.sql<{ reason: string }[]>`
      select reason from audit_log where action = 'create' and entity_type = 'user'`;
    expect(audit.map((a) => a.reason)).toEqual(['primeiro login SSO sem convite']);

    // segundo login reaproveita o mesmo usuário
    await mockLogin(app, 'ninguem@example.com');
    expect(await t.sql`select 1 from users where email = 'ninguem@example.com'`).toHaveLength(1);
  });

  it('denies inactive user without creating a session', async () => {
    await addUser('off@example.com', { active: false });
    const app = buildApp();
    const res = await mockLogin(app, 'off@example.com');
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('inativo');
    expect(await t.sql`select 1 from sessions`).toHaveLength(0);
  });

  it('denies a callback with missing or mismatched state', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const { cookies } = await startLogin(app);
    const wrong = await app.request('/auth/callback?state=forged&email=ana@example.com', {
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(wrong.status).toBe(400);
    const none = await app.request('/auth/callback?email=ana@example.com');
    expect(none.status).toBe(400);
    expect(await t.sql`select 1 from sessions`).toHaveLength(0);
  });

  it('state is single use', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const { cookies, state } = await startLogin(app);
    const url = `/auth/callback?state=${state}&email=ana@example.com`;
    const headers = { cookie: cookieHeader(cookies) };
    expect((await app.request(url, { headers })).status).toBe(302);
    expect((await app.request(url, { headers })).status).toBe(400);
  });

  it('denies an expired login state', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const { cookies, state } = await startLogin(app);
    await t.sql`update oidc_login_states set expires_at = now() - interval '1 second'`;
    const res = await app.request(`/auth/callback?state=${state}&email=ana@example.com`, {
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(res.status).toBe(400);
  });

  it('logout invalidates the session on the server', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const token = cookiesOf(await mockLogin(app, 'ana@example.com'))[SESSION_COOKIE]!;
    const headers = { cookie: `${SESSION_COOKIE}=${token}` };

    const out = await app.request('/auth/logout', { method: 'POST', headers });
    expect(out.status).toBe(200);
    expect(await t.sql`select 1 from sessions`).toHaveLength(0);
    expect((await app.request('/auth/me', { headers })).status).toBe(401);
  });

  it('rejects an expired session and removes it', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const token = cookiesOf(await mockLogin(app, 'ana@example.com'))[SESSION_COOKIE]!;
    await t.sql`update sessions set expires_at = now() - interval '1 second'`;
    const res = await app.request('/whoami', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(await res.json()).toBeNull();
    expect(await t.sql`select 1 from sessions`).toHaveLength(0);
  });

  it('rejects the session of a user deactivated after login', async () => {
    await addUser('ana@example.com');
    const app = buildApp();
    const token = cookiesOf(await mockLogin(app, 'ana@example.com'))[SESSION_COOKIE]!;
    await t.sql`update users set active = false`;
    const res = await app.request('/auth/me', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);
  });

  describe('oid binding and OIDC flow with a stub IdP', () => {
    function stub(identity: OidcIdentity | Error) {
      const calls: {
        auth?: { state: string; nonce: string; codeChallenge: string };
        expected?: OidcExpected;
      } = {};
      const provider: OidcProvider = {
        mock: false,
        authorizationUrl(p) {
          calls.auth = p;
          return Promise.resolve(new URL(`https://idp.example/authorize?state=${p.state}`));
        },
        exchange(_params, expected) {
          calls.expected = expected;
          return identity instanceof Error ? Promise.reject(identity) : Promise.resolve(identity);
        },
      };
      return { provider, calls };
    }

    it('redirects to the IdP with state, nonce and S256 challenge, then passes the verifier', async () => {
      await addUser('ana@example.com');
      const { provider, calls } = stub({
        email: 'ana@example.com',
        name: 'Ana Souza',
        oid: 'oid-1',
      });
      const app = buildApp(provider);
      const { res, cookies, state } = await startLogin(app);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('https://idp.example/authorize');
      expect(calls.auth!.state).toBe(state);

      const cb = await app.request(`/auth/callback?state=${state}&code=abc`, {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(cb.status).toBe(302);
      expect(calls.expected!.nonce).toBe(calls.auth!.nonce);
      expect(pkceChallenge(calls.expected!.codeVerifier)).toBe(calls.auth!.codeChallenge);
    });

    it('links the oid on first login and updates the name', async () => {
      await addUser('ana@example.com');
      const { provider } = stub({ email: 'ana@example.com', name: 'Ana Souza', oid: 'oid-1' });
      const app = buildApp(provider);
      const { cookies, state } = await startLogin(app);
      await app.request(`/auth/callback?state=${state}&code=abc`, {
        headers: { cookie: cookieHeader(cookies) },
      });
      const [u] = await t.sql<{ oid: string; name: string }[]>`select oid, name from users`;
      expect(u).toEqual({ oid: 'oid-1', name: 'Ana Souza' });
    });

    it('stores the directory photo, keeps it when unknown and clears it when absent', async () => {
      await addUser('ana@example.com');
      const login = async (photo: OidcIdentity['photo']) => {
        const identity: OidcIdentity = { email: 'ana@example.com', name: 'Ana', oid: 'oid-1' };
        const { provider } = stub(photo === undefined ? identity : { ...identity, photo });
        const app = buildApp(provider);
        const { cookies, state } = await startLogin(app);
        await app.request(`/auth/callback?state=${state}&code=abc`, {
          headers: { cookie: cookieHeader(cookies) },
        });
        const [u] = await t.sql<{ photo: Buffer | null; photo_type: string | null }[]>`
          select photo, photo_type from users`;
        return u!;
      };
      const stored = await login({ data: Buffer.from([1, 2, 3]), type: 'image/jpeg' });
      expect([...stored.photo!]).toEqual([1, 2, 3]);
      expect(stored.photo_type).toBe('image/jpeg');
      expect((await login(undefined)).photo_type).toBe('image/jpeg');
      expect(await login(null)).toEqual({ photo: null, photo_type: null });
    });

    it('audits the oid link and name update only when they change', async () => {
      await addUser('ana@example.com');
      const { provider } = stub({ email: 'ana@example.com', name: 'Ana Souza', oid: 'oid-1' });
      const app = buildApp(provider);
      for (let i = 0; i < 2; i++) {
        const { cookies, state } = await startLogin(app);
        await app.request(`/auth/callback?state=${state}&code=abc`, {
          headers: { cookie: cookieHeader(cookies) },
        });
      }
      const [u] = await t.sql<{ id: string }[]>`select id from users`;
      const rows = await t.sql<
        {
          actor_id: string;
          entity_id: string;
          action: string;
          before: unknown;
          after: unknown;
          reason: string;
        }[]
      >`select actor_id, entity_id, action, before, after, reason from audit_log
        where entity_type = 'user' and entity_id = ${u!.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: u!.id,
        entity_id: u!.id,
        action: 'user.link_identity',
        before: { oidLinked: false, name: 'Fulano' },
        after: { oidLinked: true, name: 'Ana Souza' },
        reason: 'primeiro acesso',
      });
      expect(JSON.stringify(rows[0])).not.toContain('oid-1');
    });

    it('denies a different oid for an already linked user', async () => {
      await addUser('ana@example.com', { oid: 'oid-1' });
      const { provider } = stub({ email: 'ana@example.com', name: 'X', oid: 'oid-2' });
      const app = buildApp(provider);
      const { cookies, state } = await startLogin(app);
      const res = await app.request(`/auth/callback?state=${state}&code=abc`, {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(res.status).toBe(403);
      expect(await t.sql`select 1 from sessions`).toHaveLength(0);
    });

    it('denies when the IdP validation fails (invalid token)', async () => {
      await addUser('ana@example.com');
      const { provider } = stub(new OidcError('bad token'));
      const app = buildApp(provider);
      const { cookies, state } = await startLogin(app);
      const res = await app.request(`/auth/callback?state=${state}&code=abc`, {
        headers: { cookie: cookieHeader(cookies), accept: 'application/json' },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'invalid_token' });
      expect(await t.sql`select 1 from sessions`).toHaveLength(0);
    });

    it('denies when the IdP returns an error', async () => {
      const { provider } = stub({ email: 'ana@example.com', name: 'A', oid: 'o' });
      const app = buildApp(provider);
      const { cookies, state } = await startLogin(app);
      const res = await app.request(`/auth/callback?state=${state}&error=access_denied`, {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(res.status).toBe(403);
    });

    it('redirects HTML navigation to /login with the denial reason', async () => {
      await addUser('off@example.com', { active: false });
      const { provider } = stub({ email: 'off@example.com', name: 'G', oid: 'o' });
      const app = buildApp(provider);
      const { cookies, state } = await startLogin(app);
      const res = await app.request(`/auth/callback?state=${state}&code=abc`, {
        headers: { cookie: cookieHeader(cookies), accept: 'text/html' },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${options.appBaseUrl}/login?error=inactive`);

      const bad = await app.request('/auth/callback?state=x&code=abc', {
        headers: { accept: 'text/html' },
      });
      expect(bad.headers.get('location')).toContain('/login?error=invalid_state');
    });
  });

  describe('master key', () => {
    const master = { username: 'root', password: 'correct-horse-battery' };
    const withMaster: AuthOptions = { ...options, master };
    const post = (app: Hono, body: unknown) =>
      app.request('/auth/master-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('is disabled (404) when not configured', async () => {
      expect((await post(buildApp(), master)).status).toBe(404);
      const cfg = await buildApp().request('/auth/config');
      expect(await cfg.json()).toEqual({ masterLogin: false });
    });

    it('logs in as a manager outside the rotation and audits it', async () => {
      const app = buildApp(undefined, withMaster);
      expect(await (await app.request('/auth/config')).json()).toEqual({ masterLogin: true });
      const res = await post(app, master);
      expect(res.status).toBe(200);
      const token = cookiesOf(res)[SESSION_COOKIE]!;
      const me = await app.request('/auth/me', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      expect(await me.json()).toMatchObject({
        name: 'root',
        role: 'manager',
        participatesInRotation: false,
        isMaster: true,
      });
      const actions = await t.sql<{ action: string }[]>`select action from audit_log order by id`;
      expect(actions.map((a) => a.action)).toEqual(['create', 'master.login']);
    });

    it('denies wrong credentials without a session', async () => {
      const app = buildApp(undefined, withMaster);
      for (const body of [
        { username: 'root', password: 'wrong' },
        { username: 'other', password: master.password },
        { username: 1, password: 2 },
        {},
      ]) {
        const res = await post(app, body);
        expect(res.status).toBe(401);
        expect(cookiesOf(res)[SESSION_COOKIE]).toBeUndefined();
      }
      expect(await t.sql`select 1 from sessions`).toHaveLength(0);
    });

    it('blocks after repeated failures even with the right password', async () => {
      const app = buildApp(undefined, withMaster);
      for (let i = 0; i < 5; i++) await post(app, { username: 'root', password: 'x' });
      expect((await post(app, master)).status).toBe(429);
    });

    it('is deactivated and loses sessions when the config is removed', async () => {
      const app = buildApp(undefined, withMaster);
      const token = cookiesOf(await post(app, master))[SESSION_COOKIE]!;
      await syncMasterUser(t.sql, undefined);
      const me = await app.request('/auth/me', {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      expect(me.status).toBe(401);
      expect(await t.sql`select 1 from users where is_master and not active`).toHaveLength(1);
    });

    it('cannot be impersonated through SSO with the internal e-mail', async () => {
      await syncMasterUser(t.sql, master);
      const app = buildApp(undefined, withMaster);
      const res = await mockLogin(app, MASTER_EMAIL);
      const token = cookiesOf(res)[SESSION_COOKIE];
      expect(token).toBeUndefined();
    });
  });

  describe('bootstrapManagers', () => {
    it('creates active managers outside the rotation', async () => {
      const created = await bootstrapManagers(t.sql, ['Gestor@Example.com', 'gestor@example.com']);
      expect(created).toEqual(['gestor@example.com']);
      const [u] = await t.sql`select role, active, participates_in_rotation from users`;
      expect(u).toMatchObject({ role: 'manager', active: true, participates_in_rotation: false });
    });

    it('promotes and reactivates existing users, keeping other fields', async () => {
      await addUser('membro@example.com', { active: false });
      await t.sql`update users set participates_in_rotation = true`;
      expect(await bootstrapManagers(t.sql, ['membro@example.com'])).toEqual([
        'membro@example.com',
      ]);
      const [m] = await t.sql`select role, active, participates_in_rotation, name from users`;
      expect(m).toMatchObject({
        role: 'manager',
        active: true,
        participates_in_rotation: true,
        name: 'Fulano',
      });
      const [{ id }] = await t.sql<{ id: string }[]>`select id from users`;
      const audit = await t.sql`select actor_id, action, before, after from audit_log
        where entity_type = 'user' and entity_id = ${id}`;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_id: null,
        action: 'update',
        before: { role: 'member', active: false },
        after: { role: 'manager', active: true },
      });
    });

    it('is idempotent: audits only on change and never repeats', async () => {
      expect(await bootstrapManagers(t.sql, ['novo@example.com'])).toEqual(['novo@example.com']);
      expect(await bootstrapManagers(t.sql, ['novo@example.com'])).toEqual([]);
      expect(await t.sql`select 1 from users`).toHaveLength(1);
      const [{ id }] = await t.sql<{ id: string }[]>`select id from users`;
      expect(
        await t.sql`select action from audit_log where entity_type = 'user' and entity_id = ${id}`,
      ).toEqual([{ action: 'create' }]);
    });
  });
});

describe('oidc helpers', () => {
  it('derives the S256 PKCE challenge', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('maps Entra claims to an identity', () => {
    expect(
      claimsToIdentity({ preferred_username: 'Ana@Example.com', oid: 'o1', name: 'Ana' }),
    ).toEqual({ email: 'ana@example.com', name: 'Ana', oid: 'o1' });
    expect(claimsToIdentity({ email: 'b@example.com', sub: 's1' })).toMatchObject({ oid: 's1' });
    expect(() => claimsToIdentity({ oid: 'o1' })).toThrow(OidcError);
    expect(() => claimsToIdentity({ email: 'a@b.c' })).toThrow(OidcError);
  });

  it('fetches the Graph photo without ever failing the login', async () => {
    const respond = (res: Response | Error) =>
      (() =>
        res instanceof Error
          ? Promise.reject(res)
          : Promise.resolve(res)) as unknown as typeof fetch;
    const jpeg = new Response(new Uint8Array([9, 9]), {
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(await fetchGraphPhoto('tk', respond(jpeg))).toMatchObject({ type: 'image/jpeg' });
    expect(await fetchGraphPhoto('tk', respond(new Response(null, { status: 404 })))).toBeNull();
    expect(
      await fetchGraphPhoto('tk', respond(new Response('x', { status: 401 }))),
    ).toBeUndefined();
    const html = new Response('<p>', { headers: { 'content-type': 'text/html' } });
    expect(await fetchGraphPhoto('tk', respond(html))).toBeUndefined();
    expect(await fetchGraphPhoto('tk', respond(new Error('offline')))).toBeUndefined();
  });

  it('requires issuer, client id and secret for the real provider', () => {
    expect(() => createEntraProvider({ mock: false }, 'http://x/auth/callback')).toThrow();
  });

  it('refuses the mock IdP in production', () => {
    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      expect(() => createAuthRouter({ db: undefined as never, logger, options })).toThrow(
        /produção/,
      );
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  });
});
