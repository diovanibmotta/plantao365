import { enqueueEmail, renderUnavailabilityConflictEmail } from '../email/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import type { UnavailabilityConflictEvent } from '../unavailability/index.js';

export interface UnavailabilityEventsDeps {
  db: Sql;
  /** URL base do web (APP_BASE_URL); habilita o link no e-mail. */
  appBaseUrl?: string | undefined;
  now?: (() => Date) | undefined;
  logger?: Logger | undefined;
}

/**
 * Req. 5.6: avisa os gestores ativos por e-mail (outbox) que uma exceção de membro conflita com
 * plantão publicado. O e-mail traz membro, período e datas em conflito, sem tipo nem observação.
 * dedupe_key por exceção + conjunto de datas + gestor: reenvio idêntico não duplica; se uma edição
 * ampliar os conflitos, os gestores recebem um novo aviso. Retorna quantos e-mails foram enfileirados.
 */
export async function notifyUnavailabilityConflict(
  sql: Sql,
  event: UnavailabilityConflictEvent,
  opts: { appBaseUrl?: string | undefined; now?: Date } = {},
): Promise<number> {
  if (event.dates.length === 0) return 0;
  const [member] = await sql<{ name: string }[]>`
    select name from users where id = ${event.userId}`;
  if (!member) return 0;
  const managers = await sql<{ id: string; email: string }[]>`
    select id, email from users where active and role = 'manager' order by id`;
  const appUrl = opts.appBaseUrl ? new URL('/escala', opts.appBaseUrl).href : undefined;
  const dates = [...new Set(event.dates)].sort();
  const rendered = renderUnavailabilityConflictEmail({
    memberName: member.name,
    startDate: event.startDate,
    endDate: event.endDate,
    dates,
    appUrl,
  });

  let queued = 0;
  for (const m of managers) {
    const r = await enqueueEmail(
      sql,
      {
        to: m.email,
        ...rendered,
        dedupeKey: `unavailability-conflict:${event.unavailabilityId}:${dates.join(',')}:${m.id}`,
      },
      opts.now,
    );
    if (!r.duplicate) queued += 1;
  }
  return queued;
}

/**
 * Gancho `onConflict` do UnavailabilityRouter. Usa o `sql` da transação da mutação (default
 * `deps.db`), então o outbox é atômico com a exceção. Registra e RELANÇA o erro: o router o captura
 * num savepoint (capturar aqui deixaria a transação abortada).
 */
export function createOnUnavailabilityConflict(
  deps: UnavailabilityEventsDeps,
): (event: UnavailabilityConflictEvent, sql?: Sql) => Promise<void> {
  return async (event, sql = deps.db) => {
    try {
      await notifyUnavailabilityConflict(sql, event, {
        appBaseUrl: deps.appBaseUrl,
        ...(deps.now ? { now: deps.now() } : {}),
      });
    } catch (err) {
      deps.logger?.error(
        { err, unavailabilityId: event.unavailabilityId },
        'Falha ao enfileirar e-mail de conflito de exceção',
      );
      throw err;
    }
  };
}
