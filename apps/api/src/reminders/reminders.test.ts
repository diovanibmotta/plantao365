import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Sql } from '../db.js';
import { createSmtpMailer } from '../email/mailer.js';
import { processOutbox } from '../email/outbox.js';
import { startTestSmtp, type TestSmtp } from '../email/test-smtp.js';
import { createLogger } from '../logger.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import { startReminderJob } from './job.js';
import { runReminders } from './service.js';

const NOW = new Date('2026-03-14T12:00:00Z');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

let db: TestDb;
let sql: Sql;
let seq = 0;
let managerId: string;

beforeAll(async () => {
  db = await createTestDb();
  sql = db.sql;
});
afterAll(async () => {
  await db.drop();
});

beforeEach(async () => {
  await sql`truncate email_outbox, shifts, schedules, users restart identity cascade`;
  seq = 0;
  managerId = await addUser({ email: 'gestor@example.com', name: 'Gestor' });
});

async function addUser(
  o: { email?: string; name?: string; active?: boolean; reminders?: boolean } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into users (name, email, active, reminders_enabled)
    values (${o.name ?? 'Ana Souza'}, ${o.email ?? `u${(seq += 1)}@example.com`},
            ${o.active ?? true}, ${o.reminders ?? true})
    returning id`;
  return row!.id;
}

async function addSchedule(status: 'draft' | 'published' = 'published'): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into schedules (start_date, end_date, status, created_by)
    values ('2026-03-01', '2026-03-31', ${status}, ${managerId}) returning id`;
  return row!.id;
}

async function addShift(
  scheduleId: string,
  o: { userId: string | null; startsAt: Date; hours?: number; date?: string },
): Promise<string> {
  seq += 1;
  const hours = o.hours ?? 14;
  const date = o.date ?? `2026-03-${String(seq).padStart(2, '0')}`;
  const [row] = await sql<{ id: string }[]>`
    insert into shifts (schedule_id, date, day_type, hours, starts_at, ends_at, user_id)
    values (${scheduleId}, ${date}, 'weekday', ${hours}, ${o.startsAt},
            ${new Date(o.startsAt.getTime() + hours * 3_600_000)}, ${o.userId})
    returning id`;
  return row!.id;
}

const run = (extra: Parameters<typeof runReminders>[1] = {}) =>
  runReminders(sql, { now: () => NOW, ...extra });
const outbox = () =>
  sql<{ to_address: string; subject: string; text: string; dedupe_key: string }[]>`
    select to_address, subject, text, dedupe_key from email_outbox order by created_at, id`;

describe('runReminders', () => {
  it('enfileira só plantões dentro da janela de 24h', async () => {
    const user = await addUser();
    const sc = await addSchedule();
    const inside = await addShift(sc, { userId: user, startsAt: hoursFromNow(10) });
    await addShift(sc, { userId: user, startsAt: hoursFromNow(24.5) });
    await addShift(sc, { userId: user, startsAt: hoursFromNow(-1) });
    await addShift(sc, { userId: user, startsAt: hoursFromNow(0) });
    const edge = await addShift(sc, { userId: user, startsAt: hoursFromNow(24) });

    expect(await run()).toEqual({ enqueued: 2, skipped: 0 });
    const keys = (await outbox()).map((r) => r.dedupe_key).sort();
    expect(keys).toEqual([`reminder:${inside}:${user}`, `reminder:${edge}:${user}`].sort());
  });

  it('lembra plantão publicado com menos de 24h de antecedência na próxima execução', async () => {
    const user = await addUser();
    const sc = await addSchedule();
    await addShift(sc, { userId: user, startsAt: hoursFromNow(2) });
    expect((await run()).enqueued).toBe(1);
  });

  it('ignora rascunho', async () => {
    const user = await addUser();
    await addShift(await addSchedule('draft'), { userId: user, startsAt: hoursFromNow(5) });
    expect(await run()).toEqual({ enqueued: 0, skipped: 0 });
  });

  it('ignora lembretes desligados e usuário inativo', async () => {
    const off = await addUser({ reminders: false });
    const inactive = await addUser({ active: false });
    const on = await addUser({ email: 'on@example.com' });
    const sc = await addSchedule();
    await addShift(sc, { userId: off, startsAt: hoursFromNow(3) });
    await addShift(sc, { userId: inactive, startsAt: hoursFromNow(4) });
    await addShift(sc, { userId: on, startsAt: hoursFromNow(5) });

    expect(await run()).toEqual({ enqueued: 1, skipped: 0 });
    expect((await outbox()).map((r) => r.to_address)).toEqual(['on@example.com']);
  });

  it('ignora plantão sem responsável ou com 0 h', async () => {
    const user = await addUser();
    const sc = await addSchedule();
    await addShift(sc, { userId: null, startsAt: hoursFromNow(3) });
    await addShift(sc, { userId: user, startsAt: hoursFromNow(4), hours: 0 });
    expect(await run()).toEqual({ enqueued: 0, skipped: 0 });
  });

  it('é idempotente em execuções repetidas e concorrentes', async () => {
    const user = await addUser();
    await addShift(await addSchedule(), { userId: user, startsAt: hoursFromNow(6) });

    expect((await run()).enqueued).toBe(1);
    expect(await run()).toEqual({ enqueued: 0, skipped: 0 });
    expect(await run({ now: () => hoursFromNow(1) })).toEqual({ enqueued: 0, skipped: 0 });
    expect(await outbox()).toHaveLength(1);

    await sql`truncate email_outbox`;
    const results = await Promise.all([run(), run(), run()]);
    expect(results.reduce((n, r) => n + r.enqueued, 0)).toBe(1);
    expect(await outbox()).toHaveLength(1);
  });

  it('gera novo lembrete ao novo responsável após reatribuição', async () => {
    const ana = await addUser({ email: 'ana@example.com' });
    const bia = await addUser({ email: 'bia@example.com' });
    const shift = await addShift(await addSchedule(), { userId: ana, startsAt: hoursFromNow(8) });

    await run();
    await sql`update shifts set user_id = ${bia} where id = ${shift}`;
    expect(await run()).toEqual({ enqueued: 1, skipped: 0 });
    expect((await outbox()).map((r) => r.to_address).sort()).toEqual([
      'ana@example.com',
      'bia@example.com',
    ]);
  });

  it('redige em pt-BR com data, período e horas, e link opcional', async () => {
    const user = await addUser({ name: 'Ana Souza', email: 'ana@example.com' });
    await addShift(await addSchedule(), {
      userId: user,
      startsAt: new Date('2026-03-14T23:00:00Z'),
      hours: 14,
      date: '2026-03-14',
    });
    await run({ appBaseUrl: 'https://plantao.example.com' });

    const [mail] = await outbox();
    expect(mail!.subject).toBe('Lembrete: plantão em 14/03');
    expect(mail!.text).toContain('Ana Souza');
    expect(mail!.text).toContain('sábado, 14 de março de 2026');
    expect(mail!.text).toContain('das 20:00 às 10:00 (dia seguinte)');
    expect(mail!.text).toContain('14 h');
    expect(mail!.text).toContain('https://plantao.example.com');
  });

  it('entrega o lembrete fim a fim pelo SMTP de teste', async () => {
    const smtp: TestSmtp = await startTestSmtp();
    try {
      const user = await addUser({ email: 'ana@example.com' });
      await addShift(await addSchedule(), { userId: user, startsAt: hoursFromNow(7) });
      await run();
      const mailer = createSmtpMailer(smtp.options);
      const res = await processOutbox(sql, mailer, { now: () => NOW });
      mailer.close();
      expect(res.sent).toBe(1);
      const [msg] = await smtp.waitForMessages(1);
      expect(msg!.to).toContain('ana@example.com');
      expect(msg!.subject).toMatch(/^Lembrete: plantão em \d{2}\/\d{2}$/);
    } finally {
      await smtp.close();
    }
  });
});

describe('startReminderJob', () => {
  it('executa sob demanda e para de forma limpa', async () => {
    const user = await addUser();
    await addShift(await addSchedule(), { userId: user, startsAt: hoursFromNow(5) });
    const job = startReminderJob({
      sql,
      logger: createLogger({ level: 'silent' }),
      intervalMs: 3_600_000,
      now: () => NOW,
    });
    await job.runOnce();
    await job.stop();
    expect(await outbox()).toHaveLength(1);
  });

  it('nunca lança quando o SQL falha', async () => {
    const broken = createDb('postgres://plantao@127.0.0.1:1/inexistente', { max: 1 });
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) },
    });
    const job = startReminderJob({ sql: broken, logger, intervalMs: 3_600_000 });
    await expect(job.runOnce()).resolves.toEqual({ enqueued: 0, skipped: 0 });
    await job.stop();
    await broken.end({ timeout: 1 });
    expect(lines.some((l) => l['level'] === 50)).toBe(true);
  });
});
