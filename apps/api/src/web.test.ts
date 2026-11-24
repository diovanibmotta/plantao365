import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger } from './logger.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'plantao365-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Plantao</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'site.webmanifest'), '{}');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const build = (webDistDir?: string) =>
  createApp({ logger: createLogger({ level: 'silent' }), ...(webDistDir && { webDistDir }) });

describe('front servido pela API (imagem única)', () => {
  it('sem WEB_DIST_DIR a API não serve o front', async () => {
    expect((await build().request('/')).status).toBe(404);
  });

  it('falha cedo se a pasta não tem index.html', () => {
    expect(() => build(join(dir, 'assets'))).toThrow(/index\.html/);
  });

  it('serve o index.html na raiz sem cache e com cabeçalhos de segurança', async () => {
    const res = await build(dir).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Plantao');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('assets com hash têm cache imutável', async () => {
    const res = await build(dir).request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('rotas do React Router caem no index.html', async () => {
    const res = await build(dir).request('/my-schedule');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Plantao');
  });

  it('asset inexistente é 404, não o HTML da SPA', async () => {
    expect((await build(dir).request('/assets/nao-existe.js')).status).toBe(404);
  });

  it('não intercepta /health, /api e /auth', async () => {
    const app = build(dir);
    const health = await app.request('/health');
    expect(await health.json()).toEqual({ status: 'ok' });
    for (const p of ['/api/qualquer', '/auth/qualquer']) {
      const res = await app.request(p);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('Plantao');
    }
  });

  it('serve o site.webmanifest com content-type adequado', async () => {
    const res = await build(dir).request('/site.webmanifest');
    expect(res.headers.get('content-type')).toContain('manifest+json');
  });

  it('bloqueia path traversal', async () => {
    const res = await build(dir).request('/../package.json');
    expect(await res.text()).not.toContain('"name"');
  });
});
