import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthEnv } from '../auth/index.js';
import { createLogger } from '../logger.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';
import { createPluginAssetsRouter } from './assets.js';
import { encodePackage, parsePublicKeys } from './package.js';
import { PluginRegistry } from './registry.js';
import { createPluginsRouter } from './router.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

describe.skipIf(!TEST_DATABASE_URL)('front dos plugins (/plugins-assets)', () => {
  let t: TestDb;
  let dir: string;
  let registry: PluginRegistry;
  let app: Hono<AuthEnv>;
  let master: TestUser;

  const call = (method: string, url: string, body?: unknown) =>
    app.request(url, {
      method,
      headers: {
        cookie: master.cookie,
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(path.join(os.tmpdir(), 'plugin-assets-'));
    registry = new PluginRegistry({
      sql: t.sql,
      logger: createLogger({ level: 'silent' }),
      pluginsDir: dir,
      publicKeys: parsePublicKeys(
        publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      ),
    });
    app = buildTestApp(t.sql, (a) => {
      a.route('/api', createPluginsRouter({ registry }));
      a.route('/', createPluginAssetsRouter({ registry }));
    });
    master = await loginAs(t.sql, { email: 'master@example.com', role: 'manager' });
    await t.sql`update users set is_master = true where id = ${master.id}`;

    const archive = encodePackage(
      {
        id: 'web-demo',
        name: 'Web demo',
        version: '1.2.0',
        kernelApi: '^1.0.0',
        server: { entry: 'server/index.js' },
        web: { entry: 'web/remoteEntry.js' },
      },
      {
        'server/index.js': 'export default { setup() {} };',
        'web/remoteEntry.js': 'export const x = 1;',
        'web/assets/app.css': '.a{}',
      },
    );
    await call('POST', '/api/plugins', {
      archive: archive.toString('base64'),
      signature: sign(null, archive, privateKey).toString('base64'),
    });
    await call('POST', '/api/plugins/web-demo/enable');
  });

  afterAll(async () => {
    await registry.stopAll();
    await t.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('o manifesto aponta para o remoteEntry na mesma origem', async () => {
    const body = await (await call('GET', '/api/plugins/manifest')).json();
    expect(body.plugins).toEqual([
      {
        id: 'web-demo',
        name: 'Web demo',
        version: '1.2.0',
        web: {
          entry: '/plugins-assets/web-demo/1.2.0/web/remoteEntry.js',
          remote: 'plugin_web_demo',
        },
      },
    ]);
  });

  it('serve os arquivos do front com tipo e cache imutável', async () => {
    const js = await app.request('/plugins-assets/web-demo/1.2.0/web/remoteEntry.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await js.text()).toBe('export const x = 1;');
    const css = await app.request('/plugins-assets/web-demo/1.2.0/web/assets/app.css');
    expect(css.headers.get('content-type')).toContain('text/css');
  });

  it('não expõe o código do servidor, outra versão nem plugin desabilitado', async () => {
    expect((await app.request('/plugins-assets/web-demo/1.2.0/server/index.js')).status).toBe(404);
    expect((await app.request('/plugins-assets/web-demo/9.9.9/web/remoteEntry.js')).status).toBe(
      404,
    );
    expect(
      (await app.request('/plugins-assets/web-demo/1.2.0/web/../server/index.js')).status,
    ).toBe(404);
    await call('POST', '/api/plugins/web-demo/disable');
    expect((await app.request('/plugins-assets/web-demo/1.2.0/web/remoteEntry.js')).status).toBe(
      404,
    );
  });
});
