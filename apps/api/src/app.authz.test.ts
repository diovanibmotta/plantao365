import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createSession } from './auth/sessions.js';
import { SESSION_COOKIE, type AuthOptions } from './auth/index.js';
import { createLogger } from './logger.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from './test-utils.js';

const authOptions: AuthOptions = {
  appBaseUrl: 'http://localhost:5173',
  cookieSecure: false,
  sessionTtlSeconds: 3600,
  oidc: {},
};

const DEFAULT_TEAM = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!TEST_DATABASE_URL)('authz integration', () => {
  let t: TestDb;
  let app: Hono;
  let managerCookie: string;
  let memberCookie: string;

  async function login(email: string, role: string): Promise<string> {
    const [u] = await t.sql<{ id: string }[]>`
      insert into users (email, name, role) values (${email}, 'Fulano', ${role}) returning id`;
    await t.sql`insert into team_members (team_id, user_id)
      values (${DEFAULT_TEAM}, ${u!.id})`;
    const { token } = await createSession(t.sql, u!.id, 3600);
    return `${SESSION_COOKIE}=${token}`;
  }

  beforeAll(async () => {
    t = await createTestDb();
    app = createApp({ logger: createLogger({ level: 'silent' }), db: t.sql, authOptions });
    managerCookie = await login('gestor@example.com', 'manager');
    memberCookie = await login('membro@example.com', 'member');
  });
  afterAll(async () => {
    await t.drop();
  });

  it('GET /api/audit is 401 without a session', async () => {
    expect((await app.request('/api/audit')).status).toBe(401);
  });

  it('GET /api/audit is 403 for a member', async () => {
    const res = await app.request('/api/audit', { headers: { cookie: memberCookie } });
    expect(res.status).toBe(403);
  });

  it('GET /api/audit is 200 for a manager', async () => {
    const res = await app.request('/api/audit', { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
  });

  it('member reaches non-audit /api routes (guard must not leak)', async () => {
    for (const path of [
      '/api/me',
      '/api/holidays',
      '/api/shifts/mine?from=2026-01-01&to=2026-01-31',
      '/api/swaps',
      '/api/me/balance',
    ]) {
      const res = await app.request(path, { headers: { cookie: memberCookie } });
      expect(res.status, path).toBe(200);
    }
  });

  it('POST /auth/logout requires the CSRF header', async () => {
    const blocked = await app.request('/auth/logout', {
      method: 'POST',
      headers: { cookie: memberCookie },
    });
    expect(blocked.status).toBe(403);
    const allowed = await app.request('/auth/logout', {
      method: 'POST',
      headers: { cookie: memberCookie, 'x-requested-with': 'plantao360' },
    });
    expect(allowed.status).toBe(200);
  });
});
