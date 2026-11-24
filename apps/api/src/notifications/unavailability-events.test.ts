import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import type { UnavailabilityConflictEvent } from '../unavailability/index.js';
import { createOnUnavailabilityConflict } from './unavailability-events.js';

const NOW = new Date('2026-03-01T12:00:00Z');
const BASE = 'https://plantao.example';

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'notificação de conflito de exceção (PostgreSQL)',
  () => {
    let t: TestDb;
    let sql: Sql;
    let ana: string;

    const outbox = () =>
      sql<{ to_address: string; subject: string; text: string; dedupe_key: string }[]>`
        select to_address, subject, text, dedupe_key from email_outbox order by to_address`;

    async function user(
      name: string,
      opts: { active?: boolean; role?: 'manager' | 'member' } = {},
    ): Promise<string> {
      const [r] = await sql<{ id: string }[]>`
        insert into users (name, email, active, role)
        values (${name}, ${`${name.toLowerCase()}@example.com`}, ${opts.active ?? true},
          ${opts.role ?? 'member'})
        returning id`;
      await sql`insert into team_members (team_id, user_id, role)
        values ('00000000-0000-0000-0000-000000000001', ${r!.id}, ${opts.role ?? 'member'})`;
      return r!.id;
    }

    const ev = (over: Partial<UnavailabilityConflictEvent> = {}): UnavailabilityConflictEvent => ({
      unavailabilityId: '33333333-3333-4333-8333-333333333333',
      userId: ana,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      dates: ['2026-12-02', '2026-12-04'],
      actorId: ana,
      ...over,
    });
    const hook = () =>
      createOnUnavailabilityConflict({ db: sql, appBaseUrl: BASE, now: () => NOW });

    beforeAll(async () => {
      t = await createTestDb();
      sql = t.sql;
    });
    afterAll(async () => {
      await t.drop();
    });
    beforeEach(async () => {
      await sql`delete from email_outbox`;
      await sql`delete from users`;
      ana = await user('Ana');
    });

    it('avisa só gestores ativos, sem tipo/observação, e não duplica', async () => {
      await user('Gui', { role: 'manager' });
      await user('Ines', { role: 'manager', active: false });
      await user('Bia');
      await hook()(ev());
      await hook()(ev());
      const rows = await outbox();
      expect(rows.map((r) => r.to_address)).toEqual(['gui@example.com']);
      expect(rows[0]!.subject).toBe('Exceção conflita com plantão publicado: Ana');
      expect(rows[0]!.text).toContain('01/12/2026 a 05/12/2026');
      expect(rows[0]!.text).toContain('2 de dezembro de 2026');
      expect(rows[0]!.text).toContain(`${BASE}/schedule`);
      expect(rows[0]!.dedupe_key).toMatch(/^unavailability-conflict:3333.*:2026-12-02,2026-12-04:/);
    });

    it('novo conjunto de datas gera novo aviso; sem datas ou membro, nada', async () => {
      await user('Gui', { role: 'manager' });
      await hook()(ev());
      await hook()(ev({ dates: ['2026-12-02', '2026-12-03', '2026-12-04'] }));
      expect(await outbox()).toHaveLength(2);
      await hook()(ev({ dates: [], unavailabilityId: '44444444-4444-4444-8444-444444444444' }));
      await hook()(ev({ userId: '55555555-5555-4555-8555-555555555555' }));
      expect(await outbox()).toHaveLength(2);
    });

    it('falha do banco é registrada e propagada (o router isola num savepoint)', async () => {
      const bad = createOnUnavailabilityConflict({ db: {} as Sql });
      await expect(bad(ev())).rejects.toBeDefined();
    });

    it('usa o sql recebido: rollback da transação não deixa e-mail', async () => {
      await user('Gui', { role: 'manager' });
      await expect(
        sql.begin(async (tx) => {
          await hook()(ev(), tx as unknown as Sql);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await outbox()).toHaveLength(0);
    });
  },
);
