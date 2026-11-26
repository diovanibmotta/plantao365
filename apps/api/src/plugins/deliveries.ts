import type { PluginEventHandler } from '@diovanibmotta/plantao365-plugin-sdk';
import type { Sql } from '../db.js';
import { backoffDelayMs } from '../email/index.js';
import { createLogger, type Logger } from '../logger.js';
import { startLoop, type Loop } from './loop.js';

/** O que o processador precisa do registry: quem está ativo e qual handler atende cada tipo. */
export interface DeliveryTarget {
  activeIds(): string[];
  handlerFor(pluginId: string, type: string): PluginEventHandler | undefined;
}

export interface DeliveryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  batchSize?: number;
  leaseMs?: number;
  now?: () => Date;
  logger?: Logger;
}

export interface DeliveryResult {
  processed: number;
  retried: number;
  failed: number;
}

interface DeliveryRow {
  event_id: string;
  plugin_id: string;
  attempts: number;
  type: string;
  payload: unknown;
  created_at: Date;
}

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 1_800_000,
  batchSize: 20,
  leaseMs: 300_000,
};

const errorMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 1000);

/**
 * Entrega os eventos aos plugins ativos nesta instância, cada entrega na sua transação.
 * Falha de um plugin só reagenda a entrega dele (atraso exponencial); nunca lança.
 * Entregas de plugin desabilitado ficam pendentes e são processadas quando ele voltar.
 */
export async function processPluginDeliveries(
  sql: Sql,
  target: DeliveryTarget,
  opts: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const { maxAttempts, baseDelayMs, maxDelayMs, batchSize, leaseMs } = { ...DEFAULTS, ...opts };
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger ?? createLogger({ level: 'silent' });
  const result: DeliveryResult = { processed: 0, retried: 0, failed: 0 };
  const ids = target.activeIds();
  if (ids.length === 0) return result;

  try {
    const rows = await sql.begin(async (tx) => {
      const claimed = await tx<DeliveryRow[]>`
        select d.event_id, d.plugin_id, d.attempts, e.type, e.payload, e.created_at
        from plugin_event_deliveries d
        join domain_events e on e.id = d.event_id
        where d.status = 'pending' and d.next_attempt_at <= ${now()}
          and d.plugin_id in ${tx(ids)}
        order by e.seq
        limit ${batchSize}
        for update of d skip locked`;
      for (const r of claimed) {
        await tx`
          update plugin_event_deliveries
          set next_attempt_at = ${new Date(now().getTime() + leaseMs)}
          where event_id = ${r.event_id} and plugin_id = ${r.plugin_id}`;
      }
      return claimed;
    });

    for (const row of rows) {
      const attempts = row.attempts + 1;
      const handler = target.handlerFor(row.plugin_id, row.type);
      try {
        await sql.begin(async (txRaw) => {
          const tx = txRaw as unknown as Sql;
          await handler?.(tx, {
            id: row.event_id,
            type: row.type,
            payload: row.payload,
            createdAt: row.created_at,
          });
          await tx`
            update plugin_event_deliveries
            set status = 'processed', attempts = ${attempts}, processed_at = ${now()},
                last_error = null
            where event_id = ${row.event_id} and plugin_id = ${row.plugin_id}`;
        });
        result.processed += 1;
        continue;
      } catch (err) {
        const exhausted = attempts >= maxAttempts;
        const nextAt = new Date(
          now().getTime() + (exhausted ? 0 : backoffDelayMs(attempts, baseDelayMs, maxDelayMs)),
        );
        await sql`
          update plugin_event_deliveries
          set status = ${exhausted ? 'failed' : 'pending'}, attempts = ${attempts},
              last_error = ${errorMessage(err)}, next_attempt_at = ${nextAt}
          where event_id = ${row.event_id} and plugin_id = ${row.plugin_id}`;
        if (exhausted) result.failed += 1;
        else result.retried += 1;
        logger.error(
          {
            pluginId: row.plugin_id,
            eventId: row.event_id,
            type: row.type,
            attempts,
            exhausted,
            err: errorMessage(err),
          },
          'Falha ao entregar evento ao plugin',
        );
      }
    }
  } catch (err) {
    logger.error({ err: errorMessage(err) }, 'Erro ao processar entregas de plugins');
  }
  return result;
}

export function startPluginDeliveryWorker(
  options: DeliveryOptions & { sql: Sql; target: DeliveryTarget; intervalMs?: number },
): Loop {
  const { sql, target, intervalMs = 2000, ...opts } = options;
  return startLoop(
    () => processPluginDeliveries(sql, target, opts),
    intervalMs,
    (err) => opts.logger?.error({ err: errorMessage(err) }, 'Erro no worker de plugins'),
  );
}
