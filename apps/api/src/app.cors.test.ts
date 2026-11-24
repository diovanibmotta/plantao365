import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Sql } from './db.js';
import { createLogger } from './logger.js';

const WEB = 'https://plantao.example.com';
const OTHER = 'https://evil.example.com';

function build(corsOrigins?: string[]) {
  return createApp({
    logger: createLogger({ level: 'silent' }),
    // O CORS e o CSRF respondem antes de qualquer acesso ao banco.
    db: {} as Sql,
    authOptions: {
      appBaseUrl: WEB,
      cookieSecure: true,
      sessionTtlSeconds: 3600,
      oidc: {
        issuer: undefined,
        clientId: undefined,
        clientSecret: undefined,
        redirectUri: undefined,
      },
      master: undefined,
    },
    ...(corsOrigins && { corsOrigins }),
  });
}

describe('CORS (front em outro domínio)', () => {
  it('sem CORS_ALLOWED_ORIGINS não emite cabeçalhos CORS', async () => {
    const res = await build().request('/health', { headers: { origin: WEB } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responde ao preflight com credenciais e o header de CSRF', async () => {
    const res = await build([WEB]).request('/api/schedules', {
      method: 'OPTIONS',
      headers: {
        origin: WEB,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-requested-with',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-requested-with',
    );
  });

  it('não libera origem fora da lista', async () => {
    const res = await build([WEB]).request('/health', { headers: { origin: OTHER } });
    expect(res.headers.get('access-control-allow-origin')).not.toBe(OTHER);
  });

  it('CSRF aceita a origem do front e rejeita as demais', async () => {
    const app = build([WEB]);
    const bad = await app.request('/api/x', {
      method: 'POST',
      headers: { origin: OTHER, 'x-requested-with': 'plantao360' },
    });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: 'csrf' });
  });
});
