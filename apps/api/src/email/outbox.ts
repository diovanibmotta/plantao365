import type postgres from 'postgres';
import type { Sql } from '../db.js';
import { createLogger, type Logger } from '../logger.js';
import type { EmailMessage, Mailer } from './types.js';

export type SqlOrTx = Sql | postgres.TransactionSql;

export interface EnqueueResult {
  /** Id da linha criada; `null` quando a dedupeKey já existia. */
  id: string | null;
  duplicate: boolean;
}

/**
 * Grava o e-mail na outbox (aceita uma transação, para enfileirar junto com a ação do usuário).
 * Com `dedupeKey`, uma chave já existente não é enfileirada de novo.
 */
export async function enqueueEmail(
  sql: SqlOrTx,
  message: EmailMessage,
  now: Date = new Date(),
): Promise<EnqueueResult> {
  const db = sql as Sql;
  const rows = await db<{ id: string }[]>`
    insert into email_outbox (to_address, subject, html, text, dedupe_key, next_attempt_at, created_at)
    values (
      ${message.to}, ${message.subject}, ${message.html}, ${message.text},
      ${message.dedupeKey ?? null}, ${message.notBefore ?? now}, ${now}
    )
    on conflict (dedupe_key) do nothing
    returning id`;
  const id = rows[0]?.id ?? null;
  return { id, duplicate: id === null };
}

export interface ProcessOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  batchSize?: number;
  now?: () => Date;
  logger?: Logger;
}

export interface ProcessResult {
  sent: number;
  retried: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  to_address: string;
  subject: string;
  html: string;
  text: string;
  attempts: number;
}

const DEFAULTS = { maxAttempts: 5, baseDelayMs: 60_000, maxDelayMs: 3_600_000, batchSize: 20 };

/** Atraso exponencial antes da próxima tentativa, dado o número de tentativas já feitas. */
export function backoffDelayMs(attempts: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempts - 1), maxDelayMs);
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

/**
 * Envia os e-mails pendentes e vencidos. Seguro com várias instâncias (`for update skip locked`).
 * Falhas de envio são registradas e reagendadas; nunca lança.
 */
export async function processOutbox(
  sql: Sql,
  mailer: Mailer,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const { maxAttempts, baseDelayMs, maxDelayMs, batchSize } = { ...DEFAULTS, ...opts };
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger ?? createLogger({ level: 'silent' });
  const result: ProcessResult = { sent: 0, retried: 0, failed: 0 };

  try {
    await sql.begin(async (tx) => {
      const rows = await tx<OutboxRow[]>`
        select id, to_address, subject, html, text, attempts
        from email_outbox
        where status = 'pending' and next_attempt_at <= ${now()}
        order by next_attempt_at, created_at
        limit ${batchSize}
        for update skip locked`;

      for (const row of rows) {
        const attempts = row.attempts + 1;
        try {
          await mailer.send({
            to: row.to_address,
            subject: row.subject,
            html: row.html,
            text: row.text,
          });
          await tx`
            update email_outbox
            set status = 'sent', attempts = ${attempts}, sent_at = ${now()}, last_error = null
            where id = ${row.id}`;
          result.sent += 1;
        } catch (err) {
          const message = errorMessage(err);
          const exhausted = attempts >= maxAttempts;
          const nextAt = new Date(
            now().getTime() + backoffDelayMs(attempts, baseDelayMs, maxDelayMs),
          );
          await tx`
            update email_outbox
            set status = ${exhausted ? 'failed' : 'pending'}, attempts = ${attempts},
                last_error = ${message}, next_attempt_at = ${exhausted ? now() : nextAt}
            where id = ${row.id}`;
          if (exhausted) result.failed += 1;
          else result.retried += 1;
          logger.error(
            { emailId: row.id, to: row.to_address, attempts, maxAttempts, exhausted, err: message },
            exhausted
              ? 'Falha definitiva no envio de e-mail (SMTP)'
              : 'Falha no envio de e-mail (SMTP); nova tentativa agendada',
          );
        }
      }
    });
  } catch (err) {
    logger.error({ err: errorMessage(err) }, 'Erro ao processar a outbox de e-mail');
  }
  return result;
}

export interface OutboxWorkerOptions extends ProcessOptions {
  sql: Sql;
  mailer: Mailer;
  intervalMs?: number;
}

export interface OutboxWorker {
  /** Executa um ciclo agora (reaproveita o ciclo em andamento, se houver). */
  runOnce(): Promise<ProcessResult>;
  /** Para de agendar e aguarda o ciclo em andamento terminar. */
  stop(): Promise<void>;
}

export function startOutboxWorker(options: OutboxWorkerOptions): OutboxWorker {
  const { sql, mailer, intervalMs = 5000, ...processOpts } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<ProcessResult> | undefined;

  const cycle = (): Promise<ProcessResult> => {
    running ??= processOutbox(sql, mailer, processOpts).finally(() => {
      running = undefined;
    });
    return running;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void cycle().finally(schedule);
    }, intervalMs);
    timer.unref();
  };
  schedule();

  return {
    runOnce: cycle,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
