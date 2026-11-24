import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import type { PublishedEvent, ShiftChange } from '../schedules/index.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { createOnPublished, createOnShiftChanged, notifyShiftsChanged } from './schedule-events.js';

const NOW = new Date('2026-03-01T12:00:00Z');
const BASE = 'https://plantao.example';

describe.skipIf(!process.env['TEST_DATABASE_URL'])('notificações de escala (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let ana: string;
  let bia: string;
  let inativo: string;

  const outbox = () =>
    sql<{ to_address: string; subject: string; text: string; dedupe_key: string }[]>`
      select to_address, subject, text, dedupe_key from email_outbox order by to_address, subject`;

  async function user(name: string, active = true): Promise<string> {
    const [r] = await sql<{ id: string }[]>`
      insert into users (name, email, active)
      values (${name}, ${`${name.toLowerCase()}@example.com`}, ${active}) returning id`;
    return r!.id;
  }

  const schedule = (status: 'draft' | 'published' = 'published') => ({
    id: '11111111-1111-4111-8111-111111111111',
    startDate: '2026-03-01',
    endDate: '2026-03-31',
    status,
    createdBy: ana,
    publishedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  const shift = (id: string, date: string, userId: string | null) => ({
    id,
    scheduleId: schedule().id,
    date,
    dayType: 'weekday' as const,
    hours: 14,
    startsAt: `${date}T11:00:00Z`,
    endsAt: `${date}T23:00:00Z`,
    userId,
    userName: null,
    originalUserId: null,
    originalHours: null,
  });

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
    bia = await user('Bia');
    inativo = await user('Caio', false);
  });

  it('publicação: um e-mail por membro ativo com seus plantões; sem duplicar', async () => {
    const event: PublishedEvent = {
      schedule: schedule(),
      actorId: ana,
      shifts: [
        shift('s1', '2026-03-10', ana),
        shift('s2', '2026-03-03', ana),
        shift('s3', '2026-03-05', bia),
        shift('s4', '2026-03-06', inativo),
        shift('s5', '2026-03-07', null),
      ],
    };
    const hook = createOnPublished({ db: sql, appBaseUrl: BASE, now: () => NOW });
    await hook(event);
    await hook(event);

    const rows = await outbox();
    expect(rows.map((r) => r.to_address)).toEqual(['ana@example.com', 'bia@example.com']);
    const anaMail = rows[0]!;
    expect(anaMail.subject).toBe('Escala publicada: 01/03/2026 a 31/03/2026');
    expect(anaMail.text.indexOf('3 de março')).toBeLessThan(anaMail.text.indexOf('10 de março'));
    expect(anaMail.text).not.toContain('5 de março');
    expect(anaMail.text).toContain(`${BASE}/my-schedule`);
    expect(anaMail.dedupe_key).toBe(`schedule-published:${schedule().id}:${ana}`);
  });

  it('alteração: notifica anterior e novo com o motivo', async () => {
    const change: ShiftChange = {
      schedule: schedule(),
      shift: shift('s1', '2026-03-10', bia),
      previousUserId: ana,
      newUserId: bia,
      reason: 'Atestado médico',
      actorId: ana,
    };
    const hook = createOnShiftChanged({ db: sql, now: () => NOW });
    await hook(change);
    await hook(change);

    const rows = await outbox();
    expect(rows).toHaveLength(2);
    const lost = rows.find((r) => r.to_address === 'ana@example.com')!;
    const got = rows.find((r) => r.to_address === 'bia@example.com')!;
    expect(lost.subject).toBe('Plantão removido: 10/03/2026');
    expect(got.subject).toBe('Novo plantão: 10/03/2026');
    for (const r of rows) expect(r.text).toContain('Motivo: Atestado médico');
    expect(lost.dedupe_key).toContain(`shift-changed:s1:lost:${ana}`);
  });

  it('alteração: ignora rascunho, inativos e atribuição vazia', async () => {
    const hook = createOnShiftChanged({ db: sql, now: () => NOW });
    await hook({
      schedule: schedule('draft'),
      shift: shift('s1', '2026-03-10', bia),
      previousUserId: ana,
      newUserId: bia,
      reason: null,
      actorId: ana,
    });
    expect(await outbox()).toHaveLength(0);

    await hook({
      schedule: schedule(),
      shift: shift('s1', '2026-03-10', null),
      previousUserId: inativo,
      newUserId: null,
      reason: 'x',
      actorId: ana,
    });
    expect(await outbox()).toHaveLength(0);

    await hook({
      schedule: schedule(),
      shift: shift('s1', '2026-03-10', null),
      previousUserId: ana,
      newUserId: null,
      reason: 'sem responsável',
      actorId: ana,
    });
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.to_address).toBe('ana@example.com');
  });

  it('notifyShiftsChanged: recálculo de feriado avisa o responsável das novas horas', async () => {
    const changes = [
      {
        shiftId: 's9',
        date: '2026-03-20',
        startsAt: null,
        endsAt: null,
        hours: 24,
        previousHours: 14,
        previousUserId: ana,
        newUserId: ana,
        reason: 'Feriado criado',
        changeKey: 'holiday-1',
      },
      {
        shiftId: 's10',
        date: '2026-03-21',
        startsAt: null,
        endsAt: null,
        hours: 14,
        previousHours: 14,
        previousUserId: bia,
        newUserId: bia,
        reason: 'sem mudança',
      },
    ];
    expect(await notifyShiftsChanged(sql, changes, { now: NOW })).toBe(1);
    expect(await notifyShiftsChanged(sql, changes, { now: NOW })).toBe(0);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain('de 14 h para 24 h');
    expect(rows[0]!.text).toContain('Motivo: Feriado criado');
    expect(rows[0]!.dedupe_key).toBe(`shift-changed:s9:updated:${ana}:holiday-1`);
  });
});
