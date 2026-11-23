import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../db.js';
import { createLogger } from '../logger.js';
import { createDisabledMailer, createSmtpMailer } from './mailer.js';
import {
  backoffDelayMs,
  enqueueEmail,
  processOutbox,
  startOutboxWorker,
  type ProcessOptions,
} from './outbox.js';
import { renderEmail } from './templates.js';
import { startTestSmtp, type TestSmtp } from './test-smtp.js';
import { createTestDb, type TestDb } from '../test-utils.js';
import type { Mailer } from './types.js';

function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) },
  });
  return { logger, lines };
}

const T0 = new Date('2026-03-14T12:00:00Z');
const msg = (to = 'ana@example.com', extra: Record<string, unknown> = {}) => ({
  to,
  subject: 'Olá',
  html: '<p>oi</p>',
  text: 'oi',
  ...extra,
});

describe('backoffDelayMs', () => {
  it('cresce exponencialmente e respeita o teto', () => {
    expect(backoffDelayMs(1, 1000, 60_000)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 60_000)).toBe(2000);
    expect(backoffDelayMs(4, 1000, 60_000)).toBe(8000);
    expect(backoffDelayMs(20, 1000, 60_000)).toBe(60_000);
  });
});

describe('mailer desabilitado', () => {
  it('apenas registra em log', async () => {
    const { logger, lines } = memoryLogger();
    const mailer = createDisabledMailer(logger);
    await mailer.send(msg());
    expect(mailer.kind).toBe('disabled');
    expect(lines.some((l) => l['to'] === 'ana@example.com')).toBe(true);
  });
});

describe.skipIf(!process.env['TEST_DATABASE_URL'])('outbox de e-mail (PostgreSQL)', () => {
  let t: TestDb;
  let sql: Sql;
  let smtp: TestSmtp;

  beforeAll(async () => {
    t = await createTestDb();
    sql = t.sql;
    smtp = await startTestSmtp();
  });
  afterAll(async () => {
    await smtp.close();
    await t.drop();
  });
  beforeEach(async () => {
    await sql`delete from email_outbox`;
    smtp.clear();
  });

  const rows = () =>
    sql<
      {
        status: string;
        attempts: number;
        last_error: string | null;
        next_attempt_at: Date;
        sent_at: Date | null;
      }[]
    >`select status, attempts, last_error, next_attempt_at, sent_at from email_outbox`;

  it('envia pelo SMTP real de teste com conteúdo pt-BR (12.7)', async () => {
    const mailer = createSmtpMailer(smtp.options);
    const rendered = renderEmail({
      subject: 'Plantão em 15/03: lembrete',
      paragraphs: ['Você está de plantão amanhã.'],
      shifts: [
        {
          date: '2026-03-15',
          startsAt: new Date('2026-03-15T11:00:00Z'),
          endsAt: new Date('2026-03-15T23:00:00Z'),
          hours: 12,
        },
      ],
    });
    await enqueueEmail(sql, { to: 'ana@example.com', ...rendered }, T0);

    const result = await processOutbox(sql, mailer, { now: () => T0 });
    expect(result).toEqual({ sent: 1, retried: 0, failed: 0 });

    const [mail] = await smtp.waitForMessages(1);
    expect(mail?.to).toEqual(['ana@example.com']);
    expect(mail?.subject).toBe('Plantão em 15/03: lembrete');
    expect(mail?.html).toContain('domingo, 15 de março de 2026');
    expect(mail?.text).toContain('das 08:00 às 20:00, 12 h');
    const [row] = await rows();
    expect(row?.status).toBe('sent');
    expect(row?.sent_at).toEqual(T0);
    mailer.close();
  });

  it('não envia antes de next_attempt_at (notBefore)', async () => {
    const sent: string[] = [];
    const mailer: Mailer = { kind: 'smtp', send: async (m) => void sent.push(m.to), close() {} };
    await enqueueEmail(sql, msg('a@x.com', { notBefore: new Date('2026-03-14T13:00:00Z') }), T0);
    expect((await processOutbox(sql, mailer, { now: () => T0 })).sent).toBe(0);
    expect(
      (await processOutbox(sql, mailer, { now: () => new Date('2026-03-14T13:00:00Z') })).sent,
    ).toBe(1);
    expect(sent).toEqual(['a@x.com']);
  });

  it('dedupe: mesma chave não duplica, inclusive dentro de transação (12.4)', async () => {
    const first = await enqueueEmail(sql, msg('a@x.com', { dedupeKey: 'reminder:1' }), T0);
    const second = await enqueueEmail(sql, msg('a@x.com', { dedupeKey: 'reminder:1' }), T0);
    const third = await sql.begin((tx) =>
      enqueueEmail(tx, msg('a@x.com', { dedupeKey: 'reminder:1' }), T0),
    );
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: null, duplicate: true });
    expect(third.duplicate).toBe(true);
    await enqueueEmail(sql, msg('a@x.com'), T0);
    await enqueueEmail(sql, msg('a@x.com'), T0);
    expect(await rows()).toHaveLength(3);
  });

  it('enfileirar em transação revertida não deixa e-mail na outbox', async () => {
    await expect(
      sql.begin(async (tx) => {
        await enqueueEmail(tx, msg(), T0);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await rows()).toHaveLength(0);
  });

  it('falha de SMTP: reenfileira com backoff e marca failed ao esgotar (12.5)', async () => {
    const { logger, lines } = memoryLogger();
    const mailer: Mailer = {
      kind: 'smtp',
      send: () => Promise.reject(new Error('connect ECONNREFUSED')),
      close() {},
    };
    await enqueueEmail(sql, msg(), T0);
    let now = T0;
    const opts: ProcessOptions = {
      now: () => now,
      logger,
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
    };

    expect(await processOutbox(sql, mailer, opts)).toEqual({ sent: 0, retried: 1, failed: 0 });
    let [row] = await rows();
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'connect ECONNREFUSED',
    });
    expect(row?.next_attempt_at).toEqual(new Date(T0.getTime() + 1000));

    expect(await processOutbox(sql, mailer, opts)).toEqual({ sent: 0, retried: 0, failed: 0 });

    now = new Date(T0.getTime() + 1000);
    expect((await processOutbox(sql, mailer, opts)).retried).toBe(1);
    [row] = await rows();
    expect(row?.attempts).toBe(2);
    expect(row?.next_attempt_at).toEqual(new Date(now.getTime() + 2000));

    now = new Date(now.getTime() + 2000);
    expect(await processOutbox(sql, mailer, opts)).toEqual({ sent: 0, retried: 0, failed: 1 });
    [row] = await rows();
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });

    now = new Date(now.getTime() + 3_600_000);
    expect(await processOutbox(sql, mailer, opts)).toEqual({ sent: 0, retried: 0, failed: 0 });

    const errors = lines.filter((l) => l['level'] === 50);
    expect(errors).toHaveLength(3);
    expect(errors[2]?.['exhausted']).toBe(true);
  });

  it('SMTP indisponível de verdade: não lança e mantém o e-mail para nova tentativa', async () => {
    const down = await startTestSmtp();
    const options = down.options;
    await down.close();
    const mailer = createSmtpMailer(options);
    await enqueueEmail(sql, msg(), T0);
    const result = await processOutbox(sql, mailer, { now: () => T0 });
    expect(result.retried).toBe(1);
    expect((await rows())[0]?.status).toBe('pending');
    mailer.close();
  });

  it('recupera após falha: envia na tentativa seguinte', async () => {
    let fail = true;
    const mailer: Mailer = {
      kind: 'smtp',
      send: async () => {
        if (fail) throw new Error('temporário');
      },
      close() {},
    };
    await enqueueEmail(sql, msg(), T0);
    await processOutbox(sql, mailer, { now: () => T0, baseDelayMs: 1000 });
    fail = false;
    const later = new Date(T0.getTime() + 1000);
    expect((await processOutbox(sql, mailer, { now: () => later })).sent).toBe(1);
    expect((await rows())[0]).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
  });

  it('concorrência: instâncias simultâneas enviam cada e-mail uma única vez (skip locked)', async () => {
    for (let i = 0; i < 12; i += 1) await enqueueEmail(sql, msg(`u${i}@x.com`), T0);
    const sent: string[] = [];
    const mailer: Mailer = {
      kind: 'smtp',
      send: async (m) => {
        await new Promise((r) => setTimeout(r, 15));
        sent.push(m.to);
      },
      close() {},
    };
    const results = await Promise.all(
      [1, 2, 3].map(() => processOutbox(sql, mailer, { now: () => T0, batchSize: 4 })),
    );
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(12);
    expect(new Set(sent).size).toBe(12);
    expect(sent).toHaveLength(12);
    expect((await rows()).every((r) => r.status === 'sent')).toBe(true);
  });

  it('nunca lança, mesmo com a tabela indisponível', async () => {
    const { logger, lines } = memoryLogger();
    const broken = { begin: () => Promise.reject(new Error('db down')) } as unknown as Sql;
    const mailer = createDisabledMailer(logger);
    await expect(processOutbox(broken, mailer, { logger })).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
    expect(lines.some((l) => l['err'] === 'db down')).toBe(true);
  });

  it('worker processa em intervalo e para de forma limpa', async () => {
    const sent: string[] = [];
    const mailer: Mailer = { kind: 'smtp', send: async (m) => void sent.push(m.to), close() {} };
    await enqueueEmail(sql, msg('w@x.com'), T0);
    const worker = startOutboxWorker({ sql, mailer, intervalMs: 20, now: () => T0 });
    const deadline = Date.now() + 3000;
    while (sent.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    await worker.stop();
    expect(sent).toEqual(['w@x.com']);

    await enqueueEmail(sql, msg('after@x.com'), T0);
    await new Promise((r) => setTimeout(r, 80));
    expect(sent).toEqual(['w@x.com']);
    expect((await worker.runOnce()).sent).toBe(1);
  });
});
