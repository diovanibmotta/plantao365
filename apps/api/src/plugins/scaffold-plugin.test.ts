import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { create, main, signFile } from '@diovanibmotta/plantao365-plugin-sdk/cli';
import { createApp } from '../app.js';
import type { Sql } from '../db.js';
import { createLogger } from '../logger.js';
import { csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';
import { parsePublicKeys } from './package.js';
import { PluginRegistry } from './registry.js';

/*
 * E2E do caminho do autor sobre o projeto que a CLI gera: create → build (esbuild + Vite/MF +
 * lint) → pack → sign → install por token → enable → rota, migração e front servidos pelo app
 * completo. Só o navegador fica de fora. Plugin real de exemplo:
 * https://github.com/diovanibmotta/plantao365-plugin-emergency-contacts
 */

// Dentro do apps/web (pasta ignorada pelo git) para o build resolver vite, React e o MF.
const WORK_ROOT = fileURLToPath(new URL('../../../web/.local', import.meta.url));
const TOKEN = 'cli-token-'.padEnd(40, 'x');

describe.skipIf(!TEST_DATABASE_URL)('plugin gerado pela CLI', () => {
  let t: TestDb;
  let sql: Sql;
  let dir: string;
  let registry: PluginRegistry;
  let app: Hono;
  let master: TestUser;
  let member: TestUser;

  const call = (method: string, url: string, user: TestUser) =>
    app.request(url, {
      method,
      headers: { cookie: user.cookie, ...csrfHeaders, origin: TEST_ORIGIN },
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    await mkdir(WORK_ROOT, { recursive: true });
    dir = await mkdtemp(path.join(WORK_ROOT, 'plugin-e2e-'));
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    registry = new PluginRegistry({
      sql,
      logger: createLogger({ level: 'silent' }),
      pluginsDir: path.join(dir, 'cache'),
      publicKeys: parsePublicKeys(
        publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      ),
    });
    // App completo (mesma ordem de middlewares e routers da produção), não um router isolado.
    app = createApp({
      logger: createLogger({ level: 'silent' }),
      db: sql,
      authOptions: {
        appBaseUrl: TEST_ORIGIN,
        cookieSecure: false,
        sessionTtlSeconds: 3600,
        oidc: {},
      },
      plugins: registry,
      pluginInstallToken: TOKEN,
    });
    master = await loginAs(sql, { email: 'master@example.com', role: 'manager' });
    await sql`update users set is_master = true where id = ${master.id}`;
    member = await loginAs(sql, { email: 'membro@example.com' });

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const project = path.join(dir, 'demo-plugin');
    await create('demo-plugin', project);
    expect(await main(['build', project])).toBe(0);
    const archive = path.join(dir, 'demo-plugin.p365');
    expect(await main(['pack', project, '--out', archive])).toBe(0);
    await signFile(archive, privateKey.export({ format: 'pem', type: 'pkcs8' }) as string);

    // `install` da CLI faz POST /api/plugins com Bearer: aqui o fetch vai direto para o app.
    vi.stubGlobal('fetch', (url: URL, init: RequestInit) => app.request(url.pathname, init));
    expect(await main(['install', archive, '--url', 'http://api.test', '--token', TOKEN])).toBe(0);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }, 120_000);

  afterAll(async () => {
    await registry.stopAll();
    await t.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('habilita, migra no schema próprio e serve a rota do plugin', async () => {
    expect((await call('POST', '/api/plugins/demo-plugin/enable', master)).status).toBe(200);
    const [table] = await sql`select to_regclass('plugin_demo_plugin.notes') as name`;
    expect(table?.name).not.toBeNull();
    const res = await call('GET', '/api/extensions/demo-plugin/hello', member);
    expect(await res.json()).toEqual({ message: 'Olá' });
  });

  it('publica o front com styleCheck e entrega o remoteEntry versionado', async () => {
    const [row] = await sql<{ manifest: { styleCheck?: string } }[]>`
      select manifest from plugin_packages where plugin_id = 'demo-plugin'`;
    expect(row?.manifest.styleCheck).toBe('passed');
    const { plugins } = (await (await call('GET', '/api/plugins/manifest', member)).json()) as {
      plugins: { web: { entry: string; remote: string } }[];
    };
    expect(plugins[0]?.web.remote).toBe('plugin_demo_plugin');
    expect((await app.request(plugins[0]!.web.entry)).status).toBe(200);
  });
});
