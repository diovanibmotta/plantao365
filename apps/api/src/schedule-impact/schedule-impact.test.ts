import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createTestDb, drainEvents, type TestDb } from '../test-utils.js';
import { runScheduleImpact } from './run.js';
import {
  assessScheduleConflicts,
  assessScheduleImpact,
  createScheduleImpactNotifier,
} from './service.js';

const TEAM = '00000000-0000-0000-0000-000000000001';
const BASE = 'https://plantao.example';
const NOW = new Date('2026-03-01T12:00:00Z');

describe.skipIf(!process.env['TEST_DATABASE_URL'])(
  'impacto em escala publicada (PostgreSQL)',
  () => {
    let t: TestDb;
    let sql: Sql;
    let gestor: string;
    let ana: string;

    async function user(name: string, role: 'manager' | 'member'): Promise<string> {
      const [r] = await sql<{ id: string }[]>`
        insert into users (name, email, role)
        values (${name}, ${`${name.toLowerCase()}@example.com`}, ${role}) returning id`;
      await sql`insert into team_members (team_id, user_id, role)
        values (${TEAM}, ${r!.id}, ${role})`;
      return r!.id;
    }

    /** Escala publicada com plantões de dia útil 18h–08h (14h) em cada data. */
    async function published(dates: string[], userId: string | null) {
      const [s] = await sql<{ id: string }[]>`
        insert into schedules (start_date, end_date, status, created_by, team_id)
        values (${dates[0]!}, ${dates.at(-1)!}, 'published', ${gestor}, ${TEAM}) returning id`;
      for (const d of dates) {
        await sql`insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id)
          values (${s!.id}, ${d}::date, 'weekday', 14, ${`${d}T21:00:00Z`}, ${`${d}T11:00:00Z`},
            ${userId})`;
      }
    }

    const notify = createScheduleImpactNotifier();
    const events = () => sql<{ type: string }[]>`select type from domain_events order by seq`;

    beforeAll(async () => {
      t = await createTestDb();
      sql = t.sql;
    });
    afterAll(async () => {
      await t.drop();
    });
    beforeEach(async () => {
      await sql`delete from email_outbox`;
      await sql`delete from domain_events`;
      await sql`delete from schedules`;
      await sql`delete from shift_exceptions`;
      await sql`delete from unavailabilities`;
      await sql`delete from users`;
      gestor = await user('Gestor', 'manager');
      ana = await user('Ana', 'member');
    });

    it('exceção de membro: só plantões publicados dele no período contam', async () => {
      await published(['2099-12-01', '2099-12-02', '2099-12-09'], ana);
      const teams = await assessScheduleImpact(sql, {
        source: 'member_exception',
        actorId: ana,
        userId: ana,
        start: '2099-12-01',
        end: '2099-12-05',
      });
      expect(teams).toEqual([{ teamId: TEAM, dates: ['2099-12-01', '2099-12-02'], shifts: 2 }]);
      expect(
        await assessScheduleImpact(sql, {
          source: 'member_exception',
          actorId: ana,
          userId: gestor,
          start: '2099-12-01',
          end: '2099-12-05',
        }),
      ).toEqual([]);
    });

    it('sem impacto não publica evento nem devolve aviso', async () => {
      const impact = await notify(sql, {
        source: 'holiday',
        actorId: gestor,
        dates: ['2099-12-25'],
      });
      expect(impact).toBeNull();
      expect(await events()).toEqual([]);
    });

    it('feriado e férias coletivas: aviso em tela e e-mail ao gestor, inclusive autor', async () => {
      await published(['2099-12-24', '2099-12-25'], ana);
      const holiday = await notify(sql, {
        source: 'holiday',
        actorId: gestor,
        dates: ['2099-12-25'],
      });
      expect(holiday?.shifts).toBe(1);
      expect(holiday?.message).toContain('avisados por e-mail');
      const collective = await notify(sql, {
        source: 'collective_vacation',
        actorId: gestor,
        teamId: TEAM,
        start: '2099-12-24',
        end: '2099-12-26',
      });
      expect(collective?.shifts).toBe(2);
      expect((await events()).map((e) => e.type)).toEqual(['schedule.impact', 'schedule.impact']);

      await drainEvents(sql, { appBaseUrl: BASE, now: NOW });
      const mails = await sql<{ to_address: string; subject: string; text: string }[]>`
        select to_address, subject, text from email_outbox order by created_at`;
      expect(mails).toHaveLength(2);
      expect(mails.every((m) => m.to_address === 'gestor@example.com')).toBe(true);
      expect(mails.some((m) => m.text.includes('25 de dezembro'))).toBe(true);
      expect(mails[0]!.subject).toMatch(/^Escala publicada precisa de revisão: /);
    });

    it('horário: só conta plantão cujo horário diverge da configuração atual', async () => {
      await published(['2099-06-01', '2099-06-02'], ana);
      expect(
        await assessScheduleImpact(sql, { source: 'shift_times', actorId: gestor, teamId: TEAM }),
      ).toEqual([]);
      await sql`insert into shift_exceptions (team_id, date, start_hour, end_hour)
        values (${TEAM}, '2099-06-02', 12, 8)`;
      const teams = await assessScheduleImpact(sql, {
        source: 'shift_exception',
        actorId: gestor,
        teamId: TEAM,
      });
      expect(teams).toEqual([{ teamId: TEAM, dates: ['2099-06-02'], shifts: 1 }]);
    });

    it('conflitos da escala: férias do responsável, férias coletivas e plantão desatualizado', async () => {
      await published(['2099-06-01', '2099-06-02', '2099-06-03'], ana);
      const ids = (await sql<{ id: string }[]>`select id from schedules`).map((r) => r.id);
      expect([...(await assessScheduleConflicts(sql, TEAM, ids)).values()]).toEqual([
        { unavailable: 0, outdated: 0 },
      ]);
      await sql`insert into unavailabilities (user_id, kind, start_date, end_date, created_by)
        values (${ana}, 'vacation', '2099-06-02', '2099-06-03', ${gestor})`;
      await sql`insert into shift_exceptions (team_id, date, start_hour, end_hour)
        values (${TEAM}, '2099-06-01', 12, 8)`;
      const [conflicts] = [...(await assessScheduleConflicts(sql, TEAM, ids)).values()];
      expect(conflicts).toEqual({ unavailable: 2, outdated: 1 });
      expect((await assessScheduleConflicts(sql, TEAM, [])).size).toBe(0);
    });

    it('falha do notificador não derruba a mutação (savepoint)', async () => {
      await sql.begin(async (tx) => {
        const out = await runScheduleImpact(
          tx as unknown as Sql,
          async () => {
            throw new Error('boom');
          },
          { source: 'holiday', actorId: gestor, dates: ['2099-12-25'] },
        );
        expect(out).toBeNull();
        await tx`select 1`;
      });
    });
  },
);
