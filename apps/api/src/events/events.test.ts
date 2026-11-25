import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createEventHandlers } from '../notifications/handlers.js';
import { createTestDb, drainEvents, type TestDb } from '../test-utils.js';
import { processDomainEvents, type EventHandlers } from './consumer.js';
import { publishEvent } from './publisher.js';

const NOW = new Date('2026-03-01T12:00:00Z');
const BASE = 'https://plantao.example';
const TEAM = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('eventos de domínio (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;

  const outbox = () =>
    sql<{ to_address: string; subject: string; text: string; dedupe_key: string }[]>`
      select to_address, subject, text, dedupe_key from email_outbox order by to_address, subject`;
  const events = () =>
    sql<{ type: string; status: string; attempts: number; last_error: string | null }[]>`
      select type, status, attempts, last_error from domain_events order by seq`;

  async function user(name: string, opts: { active?: boolean; manager?: boolean } = {}) {
    const [r] = await sql<{ id: string }[]>`
      insert into users (name, email, active, role)
      values (${name}, ${`${name.toLowerCase()}@example.com`}, ${opts.active ?? true},
        ${opts.manager ? 'manager' : 'member'})
      returning id`;
    await sql`insert into team_members (team_id, user_id, role)
      values (${TEAM}, ${r!.id}, ${opts.manager ? 'manager' : 'member'})`;
    return r!.id;
  }

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await sql`delete from domain_events`;
    await sql`delete from email_outbox`;
    await sql`delete from schedules`;
    await sql`delete from users`;
  });

  it('publica na transação: rollback não deixa evento; dedupeKey evita duplicar', async () => {
    await expect(
      sql.begin(async (tx) => {
        await publishEvent(tx, 'user.activated', { userId: 'x', actorId: null });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await events()).toHaveLength(0);

    const payload = { userId: 'x', actorId: null };
    const a = await publishEvent(sql, 'user.activated', payload, { dedupeKey: 'k' });
    const b = await publishEvent(sql, 'user.activated', payload, { dedupeKey: 'k' });
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ id: null, duplicate: true });
  });

  it('consome em ordem de publicação e marca como processado', async () => {
    const order: string[] = [];
    const handlers: EventHandlers = {
      'user.activated': async (_tx, e) => void order.push(`a:${e.payload.userId}`),
      'user.deactivated': async (_tx, e) => void order.push(`d:${e.payload.userId}`),
    };
    await publishEvent(sql, 'user.activated', { userId: '1', actorId: null }, { now: NOW });
    await publishEvent(sql, 'user.deactivated', { userId: '2', actorId: null }, { now: NOW });
    await publishEvent(sql, 'user.activated', { userId: '3', actorId: null }, { now: NOW });
    const r = await processDomainEvents(sql, handlers, { now: () => NOW });
    expect(r).toEqual({ processed: 3, retried: 0, failed: 0 });
    expect(order).toEqual(['a:1', 'd:2', 'a:3']);
    expect((await events()).every((e) => e.status === 'processed')).toBe(true);
    expect(await processDomainEvents(sql, handlers, { now: () => NOW })).toMatchObject({
      processed: 0,
    });
  });

  it('falha do handler desfaz o que ele gravou, reagenda e esgota em failed', async () => {
    const handlers: EventHandlers = {
      'user.activated': async (tx) => {
        await tx`insert into email_outbox (to_address, subject, html, text, dedupe_key)
          values ('x@x.com', 's', 'h', 't', 'parcial')`;
        throw new Error('boom');
      },
    };
    await publishEvent(sql, 'user.activated', { userId: '1', actorId: null }, { now: NOW });
    const opts = { now: () => NOW, maxAttempts: 2, baseDelayMs: 1000 };
    expect(await processDomainEvents(sql, handlers, opts)).toMatchObject({ retried: 1 });
    expect(await outbox()).toHaveLength(0);
    expect(await events()).toMatchObject([{ status: 'pending', attempts: 1, last_error: 'boom' }]);

    // ainda dentro do atraso: não é reivindicado
    expect(await processDomainEvents(sql, handlers, opts)).toMatchObject({
      processed: 0,
      retried: 0,
    });
    const later = { ...opts, now: () => new Date(NOW.getTime() + 60_000) };
    expect(await processDomainEvents(sql, handlers, later)).toMatchObject({ failed: 1 });
    expect(await events()).toMatchObject([{ status: 'failed', attempts: 2 }]);
  });

  describe('handlers dos eventos novos', () => {
    const drain = () => drainEvents(sql, { appBaseUrl: BASE, now: NOW });

    it('schedule.generated: avisa os outros gestores ativos da equipe', async () => {
      const gui = await user('Gui', { manager: true });
      await user('Cris', { manager: true });
      await user('Ines', { manager: true, active: false });
      await user('Bia');
      const [s] = await sql<{ id: string }[]>`
        insert into schedules (start_date, end_date, status, created_by, team_id)
        values ('2026-12-01', '2026-12-31', 'draft', ${gui}, ${TEAM}) returning id`;
      await publishEvent(
        sql,
        'schedule.generated',
        {
          scheduleId: s!.id,
          teamId: TEAM,
          startDate: '2026-12-01',
          endDate: '2026-12-31',
          actorId: gui,
          shifts: 31,
          unassignedDates: 1,
        },
        { now: NOW },
      );
      await drain();
      const rows = await outbox();
      expect(rows.map((r) => r.to_address)).toEqual(['cris@example.com']);
      expect(rows[0]!.subject).toBe('Escala em rascunho: 01/12/2026 a 31/12/2026');
      expect(rows[0]!.text).toContain(`${BASE}/schedule-admin`);
    });

    it('balance.adjusted: avisa o membro; inativo não recebe', async () => {
      const ana = await user('Ana');
      const bia = await user('Bia', { active: false });
      for (const [id, adj] of [
        [ana, 'a1'],
        [bia, 'a2'],
      ] as const) {
        await publishEvent(
          sql,
          'balance.adjusted',
          {
            adjustmentId: adj,
            userId: id,
            date: '2026-03-10',
            hours: 3,
            reason: 'Ok',
            actorId: ana,
          },
          { now: NOW },
        );
      }
      await drain();
      const rows = await outbox();
      expect(rows.map((r) => r.to_address)).toEqual(['ana@example.com']);
      expect(rows[0]!.dedupe_key).toBe('balance-adjusted:a1');
      expect(rows[0]!.text).toContain(`${BASE}/balance`);
    });

    it('team.*: adicionado, atualizado e removido; user.*: convite e acesso', async () => {
      const gui = await user('Gui', { manager: true });
      const ana = await user('Ana');
      await sql`update teams set name = 'Infra' where id = ${TEAM}`;
      const member = { teamId: TEAM, userId: ana, role: 'member' as const, actorId: gui };
      const m = { ...member, participatesInRotation: true };
      await publishEvent(sql, 'team.member_added', m, { now: NOW });
      await publishEvent(sql, 'team.member_updated', m, { now: NOW });
      await publishEvent(sql, 'team.member_removed', m, { now: NOW });
      await publishEvent(sql, 'user.invited', { userId: ana, actorId: gui }, { now: NOW });
      await publishEvent(sql, 'user.deactivated', { userId: ana, actorId: gui }, { now: NOW });
      await publishEvent(sql, 'user.activated', { userId: ana, actorId: gui }, { now: NOW });
      await drain();
      const subjects = (await outbox()).map((r) => r.subject);
      expect(subjects).toEqual(
        expect.arrayContaining([
          'Você foi adicionado à equipe Infra',
          'Seu perfil na equipe Infra foi atualizado',
          'Você foi removido da equipe Infra',
          'Você foi convidado para o Plantão365',
          'Seu acesso ao Plantão365 foi desativado',
          'Seu acesso ao Plantão365 foi reativado',
        ]),
      );
      expect(subjects).toHaveLength(6);
      expect((await events()).every((e) => e.status === 'processed')).toBe(true);
    });

    it('todo tipo do catálogo tem handler', () => {
      const handlers = createEventHandlers({ appBaseUrl: BASE });
      expect(Object.keys(handlers).sort()).toEqual([
        'balance.adjusted',
        'schedule.generated',
        'schedule.published',
        'shift.changed',
        'shifts.recalculated',
        'swap.accepted',
        'swap.approved',
        'swap.cancelled',
        'swap.declined',
        'swap.rejected',
        'swap.requested',
        'team.member_added',
        'team.member_removed',
        'team.member_updated',
        'unavailability.conflict',
        'user.activated',
        'user.deactivated',
        'user.invited',
      ]);
    });
  });
});
