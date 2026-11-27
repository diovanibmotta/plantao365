import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main, signFile } from '@diovanibmotta/plantao365-plugin-sdk/cli';
import { createApp } from '../app.js';
import type { Sql } from '../db.js';
import { processDomainEvents, publishEvent } from '../events/index.js';
import { createLogger } from '../logger.js';
import { csrfHeaders, DEFAULT_TEAM_ID, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';
import { processPluginDeliveries } from './deliveries.js';
import { parsePublicKeys } from './package.js';
import { PluginRegistry } from './registry.js';

/*
 * E2E do plugin de referência (plugins/emergency-contacts) pelo caminho real do autor:
 * CLI build (esbuild + Vite/MF + lint) → pack → sign → install por token → enable → CRUD HTTP →
 * evento do core → e-mail na outbox → job. Só o navegador fica de fora.
 */

const PLUGIN_DIR = fileURLToPath(
  new URL('../../../../plugins/emergency-contacts', import.meta.url),
);
const TOKEN = 'cli-token-'.padEnd(40, 'x');
const BASE = '/api/extensions/emergency-contacts';

describe.skipIf(!TEST_DATABASE_URL)('plugin de referência emergency-contacts', () => {
  let t: TestDb;
  let sql: Sql;
  let dir: string;
  let registry: PluginRegistry;
  let app: Hono;
  let master: TestUser;
  let manager: TestUser;
  let member: TestUser;

  const call = (method: string, url: string, user: TestUser, body?: unknown) =>
    app.request(url, {
      method,
      headers: {
        cookie: user.cookie,
        ...csrfHeaders,
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    dir = await mkdtemp(path.join(os.tmpdir(), 'plugin-ref-'));
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
    manager = await loginAs(sql, { email: 'gestor@example.com', role: 'manager' });
    member = await loginAs(sql, { email: 'membro@example.com' });

    // Build, pack e sign pela CLI, como o autor do plugin faz.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['build', PLUGIN_DIR])).toBe(0);
    const archive = path.join(dir, 'emergency-contacts.p365');
    expect(await main(['pack', PLUGIN_DIR, '--out', archive])).toBe(0);
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

  it('instala com styleCheck da CLI e serve o front pela API', async () => {
    const [row] = await sql<{ manifest: { styleCheck?: string; web?: { entry: string } } }[]>`
      select manifest from plugin_packages where plugin_id = 'emergency-contacts'`;
    expect(row?.manifest).toMatchObject({
      styleCheck: 'passed',
      web: { entry: 'web/remoteEntry.js' },
    });
    expect((await call('POST', '/api/plugins/emergency-contacts/enable', master)).status).toBe(200);
    const manifest = await (await call('GET', '/api/plugins/manifest', member)).json();
    expect(manifest.plugins).toEqual([
      expect.objectContaining({
        id: 'emergency-contacts',
        web: expect.objectContaining({ remote: 'plugin_emergency_contacts' }),
      }),
    ]);
  });

  it('CRUD por equipe: gestor cria, edita e exclui; membro só consulta', async () => {
    const created = await call('POST', `${BASE}/contacts`, manager, {
      name: 'Plantão NOC',
      phone: '+55 11 4000-1234',
      role: 'Infra',
    });
    expect(created.status).toBe(201);
    const { contact } = await created.json();

    const invalid = await call('POST', `${BASE}/contacts`, manager, { name: '', phone: '12' });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).message).toBe(
      'Nome: obrigatório. Telefone: use de 8 a 20 dígitos.',
    );
    expect((await call('POST', `${BASE}/contacts`, member, { name: 'X' })).status).toBe(403);

    const list = await (await call('GET', `${BASE}/contacts`, member)).json();
    expect(list.contacts).toMatchObject([
      { name: 'Plantão NOC', phone: '+55 11 4000-1234', teamId: DEFAULT_TEAM_ID },
    ]);

    const edited = await call('PUT', `${BASE}/contacts/${contact.id}`, manager, {
      name: 'Plantão NOC',
      phone: '+55 11 4000-9999',
      role: 'Infra',
    });
    expect((await edited.json()).contact.phone).toBe('+55 11 4000-9999');
    const [audit] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where action like 'emergency-contacts.contact.%' and entity_id = ${contact.id}`;
    expect(audit?.n).toBe(2);

    const temp = await (
      await call('POST', `${BASE}/contacts`, manager, { name: 'Temp', phone: '0800 000 0000' })
    ).json();
    expect((await call('DELETE', `${BASE}/contacts/${temp.contact.id}`, manager)).status).toBe(200);
    expect((await call('GET', `${BASE}/contacts/${temp.contact.id}`, manager)).status).toBe(404);
  });

  it('team.member_added envia os contatos a quem entra na equipe', async () => {
    const [newcomer] = await sql<{ id: string }[]>`
      insert into users (email, name) values ('novo@example.com', 'Nova Pessoa') returning id`;
    await publishEvent(sql, 'team.member_added', {
      teamId: DEFAULT_TEAM_ID,
      userId: newcomer!.id,
      role: 'member',
      participatesInRotation: true,
      actorId: manager.id,
    });
    await processDomainEvents(sql, {}, { fanOut: (type) => registry.subscribersOf(type) });
    await processPluginDeliveries(sql, registry);

    const [email] = await sql<{ subject: string; text: string }[]>`
      select subject, text from email_outbox
      where to_address = 'novo@example.com' and dedupe_key like 'emergency-contacts:welcome:%'`;
    expect(email?.subject).toMatch(/^Contatos de emergência da equipe /);
    expect(email?.text).toContain('Plantão NOC (Infra): +55 11 4000-9999');
  });

  it('job marca para revisão os contatos sem edição no prazo', async () => {
    await sql`
      update plugin_emergency_contacts.contacts set reviewed_at = now() - interval '200 days'`;
    // Mesmo bundle que o kernel carrega, com o job capturado de um ctx mínimo.
    const jobs: { run(): Promise<void> }[] = [];
    const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'dist/server/index.js')).href);
    await mod.default.setup({
      settings: { reviewDays: 180 },
      router: { get() {}, post() {}, put() {}, delete() {} },
      auth: { requireAuth: () => undefined, requireRole: () => undefined },
      events: { subscribe() {} },
      jobs: { register: (job: { run(): Promise<void> }) => jobs.push(job) },
      logger: { info() {} },
      withSchema: <T>(fn: (tx: Sql) => Promise<T>) =>
        sql.begin(async (tx) => {
          await tx`select set_config('search_path', 'plugin_emergency_contacts, public', true)`;
          return fn(tx as unknown as Sql);
        }),
    });
    await jobs[0]!.run();
    const list = await (await call('GET', `${BASE}/contacts`, member)).json();
    expect(list.contacts.every((c: { needsReview: boolean }) => c.needsReview)).toBe(true);
  });
});
