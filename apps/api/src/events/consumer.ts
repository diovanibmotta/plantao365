import type { Sql } from '../db.js';
import { createLogger, type Logger } from '../logger.js';
import type { DomainEventMap, DomainEventType, StoredEvent } from './types.js';

export interface HandlerContext {
  now: Date;
}

/**
 * Trata um evento dentro da transação `tx`: os e-mails enfileirados e a marca de "processado"
 * entram juntos ou nenhum entra (um reprocessamento nunca duplica e-mail).
 */
export type EventHandler<T extends DomainEventType> = (
  tx: Sql,
  event: StoredEvent<T>,
  ctx: HandlerContext,
) => Promise<void>;

export type EventHandlers = { [T in DomainEventType]?: EventHandler<T> };

export interface EventProcessOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  batchSize?: number;
  leaseMs?: number;
  now?: () => Date;
  logger?: Logger;
}

export interface EventProcessResult {
  processed: number;
  retried: number;
  failed: number;
}

interface EventRow {
  id: string;
  type: DomainEventType;
  payload: DomainEventMap[DomainEventType];
  attempts: number;
  created_at: Date;
}

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 1_800_000,
  batchSize: 20,
  leaseMs: 300_000,
};

const errorMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 1000);

/**
 * Lê os eventos pendentes e vencidos e executa o handler de cada tipo. Seguro com várias
 * instâncias (`for update skip locked` + lease). Falhas são registradas e reagendadas com atraso
 * exponencial; nunca lança.
 */
export async function processDomainEvents(
  sql: Sql,
  handlers: EventHandlers,
  opts: EventProcessOptions = {},
): Promise<EventProcessResult> {
  const { maxAttempts, baseDelayMs, maxDelayMs, batchSize, leaseMs } = { ...DEFAULTS, ...opts };
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger ?? createLogger({ level: 'silent' });
  const result: EventProcessResult = { processed: 0, retried: 0, failed: 0 };

  try {
    const rows = await sql.begin(async (tx) => {
      const claimed = await tx<EventRow[]>`
        select id, type, payload, attempts, created_at
        from domain_events
        where status = 'pending' and next_attempt_at <= ${now()}
        order by created_at, id
        limit ${batchSize}
        for update skip locked`;
      if (claimed.length > 0) {
        await tx`
          update domain_events
          set next_attempt_at = ${new Date(now().getTime() + leaseMs)}
          where id in ${tx(claimed.map((r) => r.id))}`;
      }
      return claimed;
    });

    for (const row of rows) {
      const attempts = row.attempts + 1;
      const handler = handlers[row.type] as EventHandler<DomainEventType> | undefined;
      let failure: string | undefined;
      try {
        await sql.begin(async (txRaw) => {
          const tx = txRaw as unknown as Sql;
          if (handler) {
            await handler(
              tx,
              {
                id: row.id,
                type: row.type,
                payload: row.payload,
                attempts: row.attempts,
                createdAt: row.created_at,
              },
              { now: now() },
            );
          }
          await tx`
            update domain_events
            set status = 'processed', attempts = ${attempts}, processed_at = ${now()},
                last_error = null
            where id = ${row.id} and status = 'pending'`;
        });
        result.processed += 1;
        if (!handler) logger.warn({ eventId: row.id, type: row.type }, 'Evento sem handler');
        continue;
      } catch (err) {
        failure = errorMessage(err);
      }

      const exhausted = attempts >= maxAttempts;
      const delay = Math.min(baseDelayMs * 2 ** Math.max(0, attempts - 1), maxDelayMs);
      const nextAt = exhausted ? now() : new Date(now().getTime() + delay);
      await sql`
        update domain_events
        set status = ${exhausted ? 'failed' : 'pending'}, attempts = ${attempts},
            last_error = ${failure}, next_attempt_at = ${nextAt}
        where id = ${row.id} and status = 'pending'`;
      if (exhausted) result.failed += 1;
      else result.retried += 1;
      logger.error(
        { eventId: row.id, type: row.type, attempts, maxAttempts, exhausted, err: failure },
        exhausted
          ? 'Falha definitiva ao processar evento'
          : 'Falha ao processar evento; nova tentativa agendada',
      );
    }
  } catch (err) {
    logger.error({ err: errorMessage(err) }, 'Erro ao processar eventos de domínio');
  }
  return result;
}

export interface EventWorkerOptions extends EventProcessOptions {
  sql: Sql;
  handlers: EventHandlers;
  intervalMs?: number;
}

export interface EventWorker {
  runOnce(): Promise<EventProcessResult>;
  stop(): Promise<void>;
}

export function startEventWorker(options: EventWorkerOptions): EventWorker {
  const { sql, handlers, intervalMs = 2000, ...processOpts } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<EventProcessResult> | undefined;

  const cycle = (): Promise<EventProcessResult> => {
    running ??= processDomainEvents(sql, handlers, processOpts).finally(() => {
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
