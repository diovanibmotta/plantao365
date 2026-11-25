import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createOnPublished, createOnShiftChanged } from '../notifications/schedule-events.js';
import { buildTestApp, csrfHeaders, loginAs, type TestUser } from '../test-app.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createSchedulesRouter, type SchedulesRouterDeps } from './router.js';

/** Sql cujo `begin` desfaz a transação depois que o callback (incluindo os ganchos) termina. */
function rollbackAfterCallback(sql: Sql): Sql {
  return new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop === 'begin') {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          target.begin(async (tx) => {
            await fn(tx);
            throw new Error('forca rollback');
          });
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'ganchos de notificação na transação (PostgreSQL)',
  () => {
    let t: TestDb;
    let sql: Sql;
    let manager: TestUser;
    let ana: TestUser;
    let bia: TestUser;

    const appWith = (over: Partial<SchedulesRouterDeps> & { db?: Sql }) =>
      buildTestApp(sql, (a) => a.route('/', createSchedulesRouter({ db: sql, ...over })));
    const call = (app: ReturnType<typeof appWith>, method: string, url: string, body: unknown) =>
      app.request(url, {
        method,
        headers: { ...csrfHeaders, 'content-type': 'application/json', cookie: manager.cookie },
        body: JSON.stringify(body),
      });
    const outboxCount = async () =>
      (await sql<{ n: number }[]>`select count(*)::int as n from email_outbox`)[0]!.n;
    const eventCount = async () =>
      (await sql<{ n: number }[]>`select count(*)::int as n from domain_events`)[0]!.n;

    async function seed(status: 'draft' | 'published', date: string) {
      const [s] = await sql<{ id: string }[]>`
        insert into schedules (start_date, end_date, status, created_by)
        values (${date}::date, ${date}::date, ${status}, ${manager.id}) returning id`;
      const [sh] = await sql<{ id: string }[]>`
        insert into shifts (schedule_id, date, day_type, hours, user_id, original_user_id,
          original_hours)
        values (${s!.id}, ${date}::date, 'weekday', 14, ${ana.id},
          ${status === 'published' ? ana.id : null}, ${status === 'published' ? 14 : null})
        returning id`;
      return { id: s!.id, shiftId: sh!.id };
    }
    const status = async (id: string) =>
      (await sql<{ status: string }[]>`select status from schedules where id = ${id}`)[0]!.status;

    beforeAll(async () => {
      t = await createTestDb();
      sql = t.sql;
      manager = await loginAs(sql, { email: 'g@x.com', role: 'manager', name: 'Gestor' });
      ana = await loginAs(sql, { email: 'ana@x.com', name: 'Ana' });
      bia = await loginAs(sql, { email: 'bia@x.com', name: 'Bia' });
    });
    afterAll(async () => {
      await t.drop();
    });
    beforeEach(async () => {
      await sql`delete from email_outbox`;
      await sql`delete from domain_events`;
    });

    it('publicação: evento e mudança na mesma transação (invisíveis fora antes do commit)', async () => {
      const d = await seed('draft', '2031-01-01');
      const seen: { inTx: string; outside: string; queued: number }[] = [];
      const real = createOnPublished({ db: sql });
      const app = appWith({
        onPublished: async (e, tx) => {
          await real(e, tx);
          seen.push({
            inTx: (
              await tx<{ s: string }[]>`select status as s from schedules where id = ${d.id}`
            )[0]!.s,
            outside: await status(d.id),
            queued: (await tx<{ n: number }[]>`select count(*)::int as n from domain_events`)[0]!.n,
          });
        },
      });
      expect((await call(app, 'POST', `/schedules/${d.id}/publish`, {})).status).toBe(200);
      expect(seen).toEqual([{ inTx: 'published', outside: 'draft', queued: 1 }]);
      expect(await status(d.id)).toBe('published');
      expect(await eventCount()).toBe(1);
    });

    it('publicação: rollback da mutação não deixa evento publicado', async () => {
      const d = await seed('draft', '2031-02-01');
      const app = appWith({
        db: rollbackAfterCallback(sql),
        onPublished: createOnPublished({ db: sql }),
      });
      const res = await call(app, 'POST', `/schedules/${d.id}/publish`, {});
      expect(res.status).toBe(500);
      expect(await status(d.id)).toBe('draft');
      expect(await eventCount()).toBe(0);
    });

    it('publicação: falha do gancho (inclusive erro SQL) não desfaz a publicação', async () => {
      const d = await seed('draft', '2031-03-01');
      const app = appWith({
        onPublished: async (_e, tx) => {
          await tx`insert into email_outbox (to_address, subject, text, dedupe_key)
            values ('x@x.com', 's', 't', 'k1')`;
          await tx`select * from tabela_inexistente`;
        },
      });
      expect((await call(app, 'POST', `/schedules/${d.id}/publish`, {})).status).toBe(200);
      expect(await status(d.id)).toBe('published');
      expect(await outboxCount()).toBe(0);
    });

    it('edição: evento na mesma transação; rollback e falha do gancho', async () => {
      const ok = await seed('published', '2031-04-01');
      const url = (d: { id: string; shiftId: string }) => `/schedules/${d.id}/shifts/${d.shiftId}`;
      const owner = async (d: { shiftId: string }) =>
        (await sql<{ u: string }[]>`select user_id as u from shifts where id = ${d.shiftId}`)[0]!.u;
      const patch = { userId: bia.id, reason: 'troca' };

      const good = appWith({ onShiftChanged: createOnShiftChanged({ db: sql }) });
      expect((await call(good, 'PATCH', url(ok), patch)).status).toBe(200);
      expect(await owner(ok)).toBe(bia.id);
      expect(await eventCount()).toBe(1);

      await sql`delete from domain_events`;
      const rb = await seed('published', '2031-05-01');
      const rolled = appWith({
        db: rollbackAfterCallback(sql),
        onShiftChanged: createOnShiftChanged({ db: sql }),
      });
      expect((await call(rolled, 'PATCH', url(rb), patch)).status).toBe(500);
      expect(await owner(rb)).toBe(ana.id);
      expect(await eventCount()).toBe(0);

      const bad = await seed('published', '2031-06-01');
      const failing = appWith({
        onShiftChanged: async (_c, tx) => {
          await tx`select * from tabela_inexistente`;
        },
      });
      expect((await call(failing, 'PATCH', url(bad), patch)).status).toBe(200);
      expect(await owner(bad)).toBe(bia.id);
    });
  },
);
