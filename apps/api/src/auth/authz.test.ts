import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireAuth, requireRole } from './authz.js';
import { csrfProtection } from './csrf.js';
import type { AuthEnv, AuthUser } from './types.js';

const user = (role: AuthUser['role']): AuthUser => ({
  id: 'u1',
  email: 'a@example.com',
  name: 'Ana',
  role,
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
});

function build(current: AuthUser | null) {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    c.set('user', current);
    await next();
  });
  app.get('/auth-only', requireAuth(), (c) => c.json({ ok: true }));
  app.get('/member', requireRole('member'), (c) => c.json({ ok: true }));
  app.get('/manager', requireRole('manager'), (c) => c.json({ ok: true }));
  return app;
}

describe('requireAuth / requireRole', () => {
  it('returns 401 without a session', async () => {
    const app = build(null);
    for (const path of ['/auth-only', '/member', '/manager']) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthenticated' });
    }
  });

  it('returns 403 when a member calls a manager route', async () => {
    const res = await build(user('member')).request('/manager');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('allows a member on member and auth-only routes', async () => {
    const app = build(user('member'));
    expect((await app.request('/member')).status).toBe(200);
    expect((await app.request('/auth-only')).status).toBe(200);
  });

  it('allows a manager everywhere', async () => {
    const app = build(user('manager'));
    for (const path of ['/auth-only', '/member', '/manager']) {
      expect((await app.request(path)).status).toBe(200);
    }
  });
});

describe('csrfProtection', () => {
  const app = new Hono();
  app.use(csrfProtection({ allowedOrigins: ['http://localhost:5173'] }));
  app.get('/x', (c) => c.json({ ok: true }));
  app.post('/x', (c) => c.json({ ok: true }));
  app.delete('/x', (c) => c.json({ ok: true }));

  const ok = { 'x-requested-with': 'plantao360' };

  it('blocks unsafe methods without the header', async () => {
    const res = await app.request('/x', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'csrf' });
    expect((await app.request('/x', { method: 'DELETE' })).status).toBe(403);
  });

  it('blocks a wrong header value', async () => {
    const res = await app.request('/x', { method: 'POST', headers: { 'x-requested-with': 'x' } });
    expect(res.status).toBe(403);
  });

  it('blocks a foreign Origin or Referer', async () => {
    const o = await app.request('/x', {
      method: 'POST',
      headers: { ...ok, origin: 'http://evil.example' },
    });
    expect(o.status).toBe(403);
    const r = await app.request('/x', {
      method: 'POST',
      headers: { ...ok, referer: 'http://evil.example/page' },
    });
    expect(r.status).toBe(403);
  });

  it('accepts the header with an allowed or absent Origin', async () => {
    const withOrigin = await app.request('/x', {
      method: 'POST',
      headers: { ...ok, origin: 'http://localhost:5173' },
    });
    expect(withOrigin.status).toBe(200);
    expect((await app.request('/x', { method: 'POST', headers: ok })).status).toBe(200);
  });

  it('lets safe methods through', async () => {
    expect((await app.request('/x')).status).toBe(200);
    expect((await app.request('/x', { headers: { origin: 'http://evil.example' } })).status).toBe(
      200,
    );
  });
});
