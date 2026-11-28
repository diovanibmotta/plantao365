import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guestGuard, type AuthEnv, type AuthUser } from '../auth/index.js';
import type { Sql } from '../db.js';
import { createLogger } from '../logger.js';
import { createScheduleImpactNotifier } from '../schedule-impact/index.js';
import { createSchedulesRouter } from '../schedules/index.js';
import {
  buildTestApp,
  csrfHeaders,
  DEFAULT_TEAM_ID,
  loginAs,
  TEST_ORIGIN,
  type TestUser,
} from '../test-app.js';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test-utils.js';
import { encodePackage, parsePublicKeys } from './package.js';
import { PluginRegistry } from './registry.js';
import { createPluginsRouter } from './router.js';
import type { PluginManifest } from './types.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeys = parsePublicKeys(
  publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
);

const pkg = (id: string, server: string, extra: Partial<PluginManifest> = {}) => {
  const manifest: PluginManifest = {
    id,
    name: id,
    version: '1.0.0',
    kernelApi: '^1.0.0',
    server: { entry: 'server/index.js' },
    ...extra,
  };
  const archive = encodePackage(manifest, { 'server/index.js': server });
  return {
    archive: archive.toString('base64'),
    signature: sign(null, archive, privateKey).toString('base64'),
  };
};

describe.skipIf(!TEST_DATABASE_URL)('hooks de plugin no core', () => {
  let t: TestDb;
  let sql: Sql;
  let dir: string;
  let registry: PluginRegistry;
  let app: Hono<AuthEnv>;
  let master: TestUser;
  let blocked: TestUser;

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

  const install = async (id: string, server: string, extra: Partial<PluginManifest> = {}) => {
    expect((await call('POST', '/api/plugins', master, pkg(id, server, extra))).status).toBe(201);
    expect((await call('POST', `/api/plugins/${id}/enable`, master)).status).toBe(200);
  };

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    dir = await mkdtemp(path.join(os.tmpdir(), 'plugin-hooks-'));
    registry = new PluginRegistry({
      sql,
      logger: createLogger({ level: 'silent' }),
      pluginsDir: dir,
      publicKeys,
      scheduleImpactNotifier: createScheduleImpactNotifier(),
    });
    app = buildTestApp(sql, (a) => {
      a.route('/api', createPluginsRouter({ registry, db: sql }));
      a.route(
        '/api',
        createSchedulesRouter({ db: sql, rotationAdjusters: registry.rotationAdjusters }),
      );
    });
    master = await loginAs(sql, { email: 'master@example.com', role: 'manager' });
    await sql`update users set is_master = true where id = ${master.id}`;
    blocked = await loginAs(sql, { email: 'bloqueado@example.com' });
    await loginAs(sql, { email: 'livre@example.com' });
  });

  afterAll(async () => {
    await registry.stopAll();
    await t.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('enqueueEmail usa o layout base do core, escapa o texto e prefixa a dedupeKey', async () => {
    await install(
      'mailer',
      `export default { async setup(ctx) {
        await ctx.enqueueEmail(ctx.db, {
          to: 'livre@example.com',
          subject: 'Contato atualizado',
          paragraphs: ['Olá <b>equipe</b>'],
          dedupeKey: 'k1',
        });
      } };`,
    );
    const [row] = await sql<{ subject: string; html: string; text: string; dedupe_key: string }[]>`
      select subject, html, text, dedupe_key from email_outbox where dedupe_key = 'mailer:k1'`;
    expect(row?.subject).toBe('Contato atualizado');
    expect(row?.html).toContain('Olá &lt;b&gt;equipe&lt;/b&gt;');
    expect(row?.html).toContain('Plantão365 · mensagem automática');
    expect(row?.text).toContain('Olá <b>equipe</b>');
  });

  it('rotation.prepare bloqueia membro na geração; prepare que lança não impede gerar', async () => {
    await install(
      'blocker',
      `export default { setup(ctx) {
        ctx.hooks.rotation.prepare(async (tx, input) => {
          const [u] = await tx\`select id from users where email = 'bloqueado@example.com'\`;
          if (!input.memberIds.includes(u.id)) return null;
          return { eligible: (userId) => userId !== u.id };
        });
        ctx.hooks.rotation.prepare(async () => { throw new Error('falhou'); });
      } };`,
    );
    const res = await call('POST', '/api/schedules/generate', master, {
      from: '2031-03-03',
      to: '2031-03-16',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { shifts: { userId: string | null }[] };
    expect(body.shifts.length).toBe(14);
    expect(body.shifts.some((s) => s.userId === blocked.id)).toBe(false);
    expect(body.shifts.every((s) => s.userId !== null)).toBe(true);
  });

  it('swaps.beforeAction veta a ação com mensagem; hook que lança não veta', async () => {
    await install(
      'swap-rules',
      `export default { setup(ctx) {
        ctx.hooks.swaps.beforeAction(async () => { throw new Error('quebrou'); });
        ctx.hooks.swaps.beforeAction(async (tx, { action, swap }) =>
          action === 'approve' && swap.kind === 'swap' ? 'Permutas exigem aprovação do RH.' : null);
      } };`,
    );
    const swap = {
      id: 's1',
      kind: 'swap',
      status: 'accepted',
      requesterId: master.id,
      counterpartId: blocked.id,
    } as never;
    const veto = await sql.begin((tx) =>
      registry.swapGuard(tx as unknown as Sql, { action: 'approve', swap, actorId: master.id }),
    );
    expect(veto).toBe('Permutas exigem aprovação do RH.');
    const ok = await sql.begin((tx) =>
      registry.swapGuard(tx as unknown as Sql, { action: 'reject', swap, actorId: master.id }),
    );
    expect(ok).toBeNull();
  });

  it('scheduleImpact.run pede confirmação (409) e depois devolve o impacto', async () => {
    const [schedule] = await sql<{ id: string }[]>`
      insert into schedules (start_date, end_date, status, created_by, published_at, team_id)
      values ('2031-05-05', '2031-05-05', 'published', ${master.id}, now(), ${DEFAULT_TEAM_ID})
      returning id`;
    await sql`
      insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id)
      values (${schedule!.id}, '2031-05-05', 'weekday', 14, '2031-05-05T21:00:00Z',
        '2031-05-06T11:00:00Z', ${blocked.id})`;
    await install(
      'blocks',
      `export default { setup(ctx) {
        ctx.router.post('/blocks', async (c) => {
          const confirmed = c.req.query('confirmImpact') === 'true';
          const impact = await ctx.withSchema((tx) => ctx.scheduleImpact.run(tx,
            { actorId: c.get('user').id, teamId: c.get('teamId'), dates: ['2031-05-05'] },
            { confirmed }));
          return c.json({ scheduleImpact: impact });
        });
      } };`,
    );
    const pending = await call('POST', '/api/extensions/blocks/blocks', master);
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ error: 'schedule_impact_confirmation_required' });

    const done = await call('POST', '/api/extensions/blocks/blocks?confirmImpact=true', master);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({
      scheduleImpact: { source: 'plugin', shifts: 1, dates: ['2031-05-05'] },
    });
    const [event] = await sql`select 1 from domain_events where type = 'schedule.impact'`;
    expect(event).toBeDefined();
  });

  it('guestReadPaths libera só as rotas declaradas para o convidado', async () => {
    await install('public-board', `export default { setup() {} };`, {
      guestReadPaths: ['/board', '/items/:id'],
    });
    const guest = { id: 'g', role: 'guest' } as AuthUser;
    const probe = new Hono<AuthEnv>();
    probe.use(async (c, next) => {
      c.set('user', guest);
      await next();
    });
    probe.use('/api/*', guestGuard({ extraReadPaths: () => registry.guestReadPaths() }));
    probe.all('/api/*', (c) => c.text('ok'));

    expect((await probe.request('/api/extensions/public-board/board')).status).toBe(200);
    expect((await probe.request('/api/extensions/public-board/items/42')).status).toBe(200);
    expect((await probe.request('/api/extensions/public-board/admin')).status).toBe(403);
    expect(
      (await probe.request('/api/extensions/public-board/board', { method: 'POST' })).status,
    ).toBe(403);
    expect((await probe.request('/api/extensions/blocks/blocks')).status).toBe(403);
  });
});
