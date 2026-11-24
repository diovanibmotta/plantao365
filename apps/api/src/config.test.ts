import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/plantao360' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      MANAGER_EMAILS: [],
    });
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('parses manager e-mails, lowercasing and trimming', () => {
    const c = loadConfig({ ...base, MANAGER_EMAILS: ' Ana@Empresa.com , bia@empresa.com,' });
    expect(c.MANAGER_EMAILS).toEqual(['ana@empresa.com', 'bia@empresa.com']);
  });

  it('rejects invalid manager e-mails', () => {
    expect(() => loadConfig({ ...base, MANAGER_EMAILS: 'nao-e-email' })).toThrow(ConfigError);
  });

  it('treats empty optional variables as unset', () => {
    const c = loadConfig({ ...base, SMTP_HOST: '', SMTP_PORT: '', OIDC_ISSUER: '' });
    expect(c.SMTP_HOST).toBeUndefined();
    expect(c.SMTP_PORT).toBeUndefined();
  });

  it('requires SMTP_FROM when SMTP_HOST is set', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' })).toThrow(/SMTP_FROM/);
    expect(
      loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'plantao@example.com' })
        .SMTP_HOST,
    ).toBe('smtp.example.com');
  });

  it('production requires OIDC settings and a manager', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadConfig(prod)).toThrow(/OIDC_ISSUER[\s\S]*MANAGER_EMAILS/);
    expect(() => loadConfig({ ...prod, MANAGER_EMAILS: 'ana@empresa.com' })).toThrow(/OIDC_ISSUER/);
    const ok = loadConfig({
      ...prod,
      MANAGER_EMAILS: 'ana@empresa.com',
      OIDC_ISSUER: 'https://login.microsoftonline.com/tenant/v2.0',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'https://plantao.example.com/auth/callback',
    });
    expect(ok.NODE_ENV).toBe('production');
  });

  it('parses COOKIE_SECURE, leaving it unset when empty or missing', () => {
    expect(loadConfig({ ...base }).COOKIE_SECURE).toBeUndefined();
    expect(loadConfig({ ...base, COOKIE_SECURE: '' }).COOKIE_SECURE).toBeUndefined();
    expect(loadConfig({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ ...base, COOKIE_SECURE: '0' }).COOKIE_SECURE).toBe(false);
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'yes' })).toThrow();
  });

  it('does not leak values in error messages', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://user:supersecret@host/db' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('supersecret');
    }
  });

  it('master key needs both username and a long password', () => {
    expect(
      loadConfig({ ...base, MASTER_USERNAME: 'root', MASTER_PASSWORD: 'x'.repeat(12) }),
    ).toMatchObject({ MASTER_USERNAME: 'root' });
    expect(() => loadConfig({ ...base, MASTER_USERNAME: 'root' })).toThrow(/MASTER_PASSWORD/);
    expect(() => loadConfig({ ...base, MASTER_PASSWORD: 'x'.repeat(12) })).toThrow(
      /MASTER_USERNAME/,
    );
    expect(() =>
      loadConfig({ ...base, MASTER_USERNAME: 'root', MASTER_PASSWORD: 'curta' }),
    ).toThrow(ConfigError);
  });

  it('production accepts the master key in place of MANAGER_EMAILS', () => {
    const ok = loadConfig({
      ...base,
      NODE_ENV: 'production',
      MASTER_USERNAME: 'root',
      MASTER_PASSWORD: 'x'.repeat(12),
      OIDC_ISSUER: 'https://login.microsoftonline.com/tenant/v2.0',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'https://plantao.example.com/auth/callback',
    });
    expect(ok.MANAGER_EMAILS).toEqual([]);
  });
});
