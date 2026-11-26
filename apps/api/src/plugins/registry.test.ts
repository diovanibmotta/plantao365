import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import { processDomainEvents } from '../events/index.js';
import { createLogger } from '../logger.js';
import { buildTestApp, csrfHeaders, loginAs, TEST_ORIGIN, type TestUser } from '../test-app.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';
import { processPluginDeliveries } from './deliveries.js';
import { encodePackage, parsePublicKeys } from './package.js';
import { PluginRegistry } from './registry.js';
import { createPluginsRouter } from './router.js';
import type { PluginManifest } from './types.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeys = parsePublicKeys(
  publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
);

/** Plugin de teste: tabela própria, rotas, auditoria, evento próprio, assinatura e job. */
const demoServer = (label: string) => `
export default {
  async setup(ctx) {
    ctx.router.get('/notes', ctx.auth.requireAuth(), async (c) => {
      const rows = await ctx.withSchema((tx) => tx\`select body from notes order by id\`);
      return c.json({ label: '${label}', notes: rows.map((r) => r.body), user: c.get('user').email, settings: ctx.settings });
    });
    ctx.router.post('/notes', ctx.auth.requireRole('manager'), async (c) => {
      const { body } = await c.req.json();
      await ctx.withSchema(async (tx) => {
        await tx\`insert into notes (body) values (\${body})\`;
        await ctx.audit(tx, { actorId: c.get('user').id, action: 'note.create', entityType: 'note' });
        await ctx.events.publish(tx, 'note.created', { body });
      });
      return c.json({ ok: true }, 201);
    });
    ctx.router.get('/boom', () => { throw new Error('kaboom'); });
    ctx.events.subscribe('demo.note.created', async (tx, event) => {
      await tx\`insert into plugin_demo.notes (body) values (\${'echo:' + event.payload.body})\`;
    });
    ctx.jobs.register({ name: 'tick', intervalMs: 60000, run: async () => {} });
  },
};`;

const manifest = (id: string, version = '1.0.0'): PluginManifest => ({
  id,
  name: `Plugin ${id}`,
  version,
  kernelApi: '^1.0.0',
  server: { entry: 'server/index.js' },
});

const signed = (m: PluginManifest, files: Record<string, string>) => {
  const archive = encodePackage(m, files);
  return {
    archive: archive.toString('base64'),
    signature: sign(null, archive, privateKey).toString('base64'),
  };
};

const demoPackage = (version = '1.0.0', label = 'v1') =>
  signed(manifest('demo', version), {
    'server/index.js': demoServer(label),
    'migrations/0001_notes.up.sql': 'create table notes (id serial primary key, body text);',
    'migrations/0001_notes.down.sql': 'drop table notes;',
  });

describe.skipIf(!TEST_DATABASE_URL)('kernel de plugins', () => {
  let t: TestDb;
  let sql: Sql;
  let dir: string;
  let registry: PluginRegistry;
  let app: Hono<AuthEnv>;
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
    dir = await mkdtemp(path.join(os.tmpdir(), 'plugins-'));
    registry = new PluginRegistry({
      sql,
      logger: createLogger({ level: 'silent' }),
      pluginsDir: dir,
      publicKeys,
    });
    app = buildTestApp(sql, (a) => a.route('/', createPluginsRouter({ registry })));
    master = await loginAs(sql, { email: 'master@example.com', role: 'manager' });
    await sql`update users set is_master = true where id = ${master.id}`;
    manager = await loginAs(sql, { email: 'gestor@example.com', role: 'manager' });
    member = await loginAs(sql, { email: 'membro@example.com', role: 'member' });
  });

  afterAll(async () => {
    await registry.stopAll();
    await t.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('só a master key instala; assinatura inválida é recusada', async () => {
    expect((await call('POST', '/plugins', manager, demoPackage())).status).toBe(403);
    const bad = { ...demoPackage(), signature: demoPackage('9.9.9').signature };
    const res = await call('POST', '/plugins', master, bad);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('recusa kernelApi incompatível', async () => {
    const pkg = signed({ ...manifest('future'), kernelApi: '^2.0.0' }, { 'server/index.js': '' });
    const res = await call('POST', '/plugins', master, pkg);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'incompatible_kernel' });
  });

  it('instala, habilita, migra no schema próprio e serve rotas com o usuário do core', async () => {
    expect((await call('POST', '/plugins', master, demoPackage())).status).toBe(201);
    expect((await call('GET', '/extensions/demo/notes', member)).status).toBe(404);

    expect((await call('POST', '/plugins/demo/enable', master)).status).toBe(200);
    expect((await call('POST', '/extensions/demo/notes', member, { body: 'x' })).status).toBe(403);
    expect((await call('POST', '/extensions/demo/notes', manager, { body: 'oi' })).status).toBe(
      201,
    );

    const res = await call('GET', '/extensions/demo/notes', member);
    expect(await res.json()).toEqual({
      label: 'v1',
      notes: ['oi'],
      user: 'membro@example.com',
      settings: {},
    });
    const [audit] = await sql`select action from audit_log where action = 'demo.note.create'`;
    expect(audit).toBeDefined();

    const list = await (await call('GET', '/plugins', manager)).json();
    expect(list.plugins).toMatchObject([{ id: 'demo', status: 'enabled', active: true }]);
  });

  it('erro na rota do plugin vira 500 sem derrubar o core', async () => {
    const res = await call('GET', '/extensions/demo/boom', member);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'plugin_error' });
  });

  it('entrega eventos por plugin; falha de um assinante não afeta o outro', async () => {
    const other = signed(manifest('other'), {
      'server/index.js': `export default { setup(ctx) {
        ctx.events.subscribe('demo.note.created', async () => { throw new Error('falhou'); });
      } };`,
    });
    await call('POST', '/plugins', master, other);
    await call('POST', '/plugins/other/enable', master);
    await call('POST', '/extensions/demo/notes', manager, { body: 'evento' });

    await processDomainEvents(sql, {}, { fanOut: (type) => registry.subscribersOf(type) });
    const result = await processPluginDeliveries(sql, registry);
    // Os eventos das notas 'oi' e 'evento' vão para os dois assinantes: demo processa, other falha.
    expect(result).toMatchObject({ processed: 2, retried: 2 });

    const notes = await sql<{ body: string }[]>`select body from plugin_demo.notes order by id`;
    expect(notes.map((n) => n.body)).toEqual(['oi', 'evento', 'echo:oi', 'echo:evento']);
    const [failed] = await sql<{ status: string; last_error: string }[]>`
      select status, last_error from plugin_event_deliveries where plugin_id = 'other'`;
    expect(failed).toMatchObject({ status: 'pending', last_error: 'falhou' });
  });

  it('atualiza a versão sem restart e reaplica configuração', async () => {
    expect((await call('POST', '/plugins', master, demoPackage('1.1.0', 'v2'))).status).toBe(201);
    expect(await (await call('GET', '/extensions/demo/notes', member)).json()).toMatchObject({
      label: 'v2',
    });
    await call('PUT', '/plugins/demo/settings', master, { settings: { color: 'azul' } });
    expect(await (await call('GET', '/extensions/demo/notes', member)).json()).toMatchObject({
      settings: { color: 'azul' },
    });
    // Mesma versão com outro conteúdo é conflito.
    expect((await call('POST', '/plugins', master, demoPackage('1.1.0', 'outro'))).status).toBe(
      409,
    );
  });

  it('setup com erro deixa o plugin failed e o core segue', async () => {
    const broken = signed(manifest('broken'), {
      'server/index.js': `export default { setup() { throw new Error('quebrado'); } };`,
    });
    await call('POST', '/plugins', master, broken);
    const res = await call('POST', '/plugins/broken/enable', master);
    expect(res.status).toBe(422);
    const [row] = await sql`select status, error from plugins where id = 'broken'`;
    expect(row).toMatchObject({ status: 'failed', error: 'quebrado' });
    expect((await call('GET', '/extensions/demo/notes', member)).status).toBe(200);
  });

  it('desabilitar tira as rotas; reabilitar no boot reativa', async () => {
    await call('POST', '/plugins/demo/disable', master);
    expect((await call('GET', '/extensions/demo/notes', member)).status).toBe(404);
    await sql`update plugins set status = 'enabled' where id = 'demo'`;
    await registry.loadEnabled();
    expect((await call('GET', '/extensions/demo/notes', member)).status).toBe(200);
  });

  it('desinstalar mantém os dados; com purge remove o schema', async () => {
    await call('DELETE', '/plugins/other', master);
    const [kept] = await sql`select 1 from pg_namespace where nspname = 'plugin_demo'`;
    expect(kept).toBeDefined();
    expect((await call('DELETE', '/plugins/demo?purge=true', master)).status).toBe(200);
    const [gone] = await sql`select 1 from pg_namespace where nspname = 'plugin_demo'`;
    expect(gone).toBeUndefined();
    expect((await call('GET', '/plugins/manifest', member)).status).toBe(200);
    expect((await call('POST', '/plugins/demo/enable', master)).status).toBe(404);
  });
});
