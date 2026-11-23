import type { MiddlewareHandler } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createAuditRouter } from './router.js';
import { AUDIT_MAX_LIMIT, listAudit, recordAudit } from './service.js';

const ACTOR_A = '11111111-1111-4111-8111-111111111111';
const ACTOR_B = '22222222-2222-4222-8222-222222222222';

const allow: MiddlewareHandler = async (_c, next) => {
  await next();
};
const deny: MiddlewareHandler = (c) => c.json({ error: 'forbidden' }, 403);

type SeedRow = [string, string | null, string, string, string | null];

async function seed(sql: Sql, rows: SeedRow[]): Promise<void> {
  for (const [at, actor, action, type, id] of rows) {
    await sql`insert into audit_log (occurred_at, actor_id, action, entity_type, entity_id)
      values (${at}::timestamptz, ${actor}, ${action}, ${type}, ${id})`;
  }
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])('audit service (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`alter table audit_log disable trigger audit_log_no_truncate`;
    await sql`truncate audit_log`;
    await sql`alter table audit_log enable trigger audit_log_no_truncate`;
  });

  it('records and lists an entry with before/after', async () => {
    await recordAudit(sql, {
      actorId: ACTOR_A,
      action: 'update',
      entityType: 'shift',
      entityId: 's1',
      before: { owner: 'x' },
      after: { owner: 'y' },
      reason: 'troca',
    });
    const page = await listAudit(sql);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      actorId: ACTOR_A,
      action: 'update',
      entityType: 'shift',
      entityId: 's1',
      before: { owner: 'x' },
      after: { owner: 'y' },
      reason: 'troca',
    });
    const at = page.items[0]!.occurredAt;
    expect(new Date(at).toISOString()).toBe(at);
  });

  it('accepts a null actor and omitted optional fields', async () => {
    await recordAudit(sql, { actorId: null, action: 'create', entityType: 'holiday' });
    const [item] = (await listAudit(sql)).items;
    expect(item).toMatchObject({ actorId: null, entityId: null, before: null, after: null });
  });

  it('rejects invalid entries', async () => {
    await expect(
      recordAudit(sql, { actorId: 'x', action: 'a', entityType: 'b' }),
    ).rejects.toThrow();
    await expect(
      recordAudit(sql, { actorId: null, action: '', entityType: 'b' }),
    ).rejects.toThrow();
    expect((await listAudit(sql)).total).toBe(0);
  });

  it('orders by occurred_at desc and combines filters', async () => {
    await seed(sql, [
      ['2026-01-01T10:00:00Z', ACTOR_A, 'create', 'shift', 's1'],
      ['2026-01-02T10:00:00Z', ACTOR_B, 'update', 'shift', 's2'],
      ['2026-01-03T10:00:00Z', ACTOR_A, 'update', 'holiday', 'h1'],
      ['2026-01-04T10:00:00Z', ACTOR_A, 'delete', 'shift', 's1'],
    ]);
    const all = await listAudit(sql);
    expect(all.items.map((i) => i.occurredAt)).toEqual([
      '2026-01-04T10:00:00.000Z',
      '2026-01-03T10:00:00.000Z',
      '2026-01-02T10:00:00.000Z',
      '2026-01-01T10:00:00.000Z',
    ]);
    expect((await listAudit(sql, { actorId: ACTOR_A })).total).toBe(3);
    expect((await listAudit(sql, { entityType: 'shift' })).total).toBe(3);
    expect((await listAudit(sql, { entityType: 'shift', entityId: 's1' })).total).toBe(2);
    const combined = await listAudit(sql, {
      from: '2026-01-02T00:00:00Z',
      to: '2026-01-03T23:59:59Z',
      actorId: ACTOR_A,
    });
    expect(combined.items.map((i) => i.entityId)).toEqual(['h1']);
  });

  it('paginates and caps the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(sql, { actorId: null, action: `a${i}`, entityType: 'x' });
    }
    const first = await listAudit(sql, { limit: 2 });
    const second = await listAudit(sql, { limit: 2, offset: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(4);
    expect((await listAudit(sql, { limit: 100000 })).limit).toBe(AUDIT_MAX_LIMIT);
  });

  it('rolls back audit entries together with the transaction', async () => {
    await expect(
      sql.begin(async (tx) => {
        await recordAudit(tx, { actorId: ACTOR_A, action: 'create', entityType: 'shift' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await listAudit(sql)).total).toBe(0);

    await sql.begin(async (tx) => {
      await recordAudit(tx, { actorId: ACTOR_A, action: 'create', entityType: 'shift' });
    });
    expect((await listAudit(sql)).total).toBe(1);
  });

  it('keeps records immutable: direct UPDATE and DELETE fail', async () => {
    await recordAudit(sql, { actorId: null, action: 'create', entityType: 'x' });
    await expect(sql`update audit_log set action = 'z'`).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_log`).rejects.toThrow(/append-only/);
    expect((await listAudit(sql)).items[0]!.action).toBe('create');
  });

  it('returns actor name and email, null when the actor does not exist', async () => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (name, email) values ('Ana Souza', 'ana@example.com') returning id`;
    await recordAudit(sql, { actorId: user!.id, action: 'update', entityType: 'shift' });
    await recordAudit(sql, { actorId: ACTOR_A, action: 'update', entityType: 'shift' });
    await recordAudit(sql, { actorId: null, action: 'create', entityType: 'holiday' });
    const items = (await listAudit(sql)).items;
    const byActor = (id: string | null) => items.find((i) => i.actorId === id)!;
    expect(byActor(user!.id)).toMatchObject({
      actorName: 'Ana Souza',
      actorEmail: 'ana@example.com',
    });
    expect(byActor(ACTOR_A)).toMatchObject({ actorName: null, actorEmail: null });
    expect(byActor(null)).toMatchObject({ actorName: null, actorEmail: null });
    const filtered = await listAudit(sql, { actorId: user!.id });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]!.actorName).toBe('Ana Souza');
    await sql`delete from users where id = ${user!.id}`;
  });

  describe('router', () => {
    it('serves GET /audit through the guard with filters', async () => {
      await seed(sql, [
        ['2026-01-01T10:00:00Z', ACTOR_A, 'create', 'shift', 's1'],
        ['2026-01-02T10:00:00Z', ACTOR_B, 'update', 'holiday', 'h1'],
      ]);
      const router = createAuditRouter({ db: sql, guard: allow });
      const res = await router.request(`/audit?actorId=${ACTOR_B}&entityType=holiday`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { entityId: string }[]; total: number };
      expect(body.total).toBe(1);
      expect(body.items[0]!.entityId).toBe('h1');
    });

    it('returns 403 from the guard (member denied) without leaking data', async () => {
      await seed(sql, [['2026-01-01T10:00:00Z', ACTOR_A, 'create', 'shift', 's1']]);
      const router = createAuditRouter({ db: sql, guard: deny });
      const res = await router.request('/audit');
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('shift');
    });

    it('rejects invalid filters with 400', async () => {
      const router = createAuditRouter({ db: sql, guard: allow });
      for (const q of [
        'from=ontem',
        'actorId=abc',
        'limit=0',
        `limit=${AUDIT_MAX_LIMIT + 1}`,
        'offset=-1',
        'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
      ]) {
        const res = await router.request(`/audit?${q}`);
        expect(res.status, q).toBe(400);
      }
    });
  });
});

describe('createAuditRouter', () => {
  it('throws when the guard is missing', () => {
    const db = {} as Sql;
    expect(() => createAuditRouter({ db } as never)).toThrow(/guard/);
    expect(() => createAuditRouter({ db, guard: undefined as never })).toThrow(/guard/);
  });
});
