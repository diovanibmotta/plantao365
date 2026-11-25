import type postgres from 'postgres';
import type { Sql } from '../db.js';
import type { DomainEventMap, DomainEventType } from './types.js';

export type SqlOrTx = Sql | postgres.TransactionSql;

export interface PublishOptions {
  /** Com chave, o mesmo evento não é gravado duas vezes. */
  dedupeKey?: string | undefined;
  now?: Date | undefined;
}

export interface PublishResult {
  /** Id do evento criado; `null` quando a dedupeKey já existia. */
  id: string | null;
  duplicate: boolean;
}

/**
 * Publica um evento de domínio. Chame com a transação da ação do usuário: o evento só existe se a
 * ação for confirmada. Não envia nada; o consumidor monta e enfileira os e-mails depois.
 */
export async function publishEvent<T extends DomainEventType>(
  sql: SqlOrTx,
  type: T,
  payload: DomainEventMap[T],
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const db = sql as Sql;
  const now = opts.now ?? new Date();
  const json = JSON.parse(JSON.stringify(payload)) as postgres.JSONValue;
  const rows = await db<{ id: string }[]>`
    insert into domain_events (type, payload, dedupe_key, next_attempt_at, created_at)
    values (${type}, ${db.json(json)}, ${opts.dedupeKey ?? null}, ${now}, ${now})
    on conflict (dedupe_key) do nothing
    returning id`;
  const id = rows[0]?.id ?? null;
  return { id, duplicate: id === null };
}
