import { enqueueEmail, renderSwapEmail } from '../email/index.js';
import type { SwapEmailAudience, SwapEmailInput } from '../email/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import type { SwapEvent, SwapShiftInfo } from '../swaps/index.js';

export interface SwapEventsDeps {
  db: Sql;
  /** URL base do web (APP_BASE_URL); habilita o link nos e-mails. */
  appBaseUrl?: string | undefined;
  now?: (() => Date) | undefined;
  logger?: Logger | undefined;
}

interface Recipient {
  id: string;
  name: string;
  email: string;
}

const toShift = (s: SwapShiftInfo) => ({
  date: s.date,
  startsAt: s.startsAt ? new Date(s.startsAt) : null,
  endsAt: s.endsAt ? new Date(s.endsAt) : null,
  hours: s.hours,
});

async function activeUsers(sql: Sql, ids: string[]): Promise<Map<string, Recipient>> {
  const rows = await sql<Recipient[]>`
    select id, name, email from users where active and id in ${sql(ids)}`;
  return new Map(rows.map((r) => [r.id, r]));
}

async function activeManagers(sql: Sql): Promise<Recipient[]> {
  return sql<Recipient[]>`
    select id, name, email from users where active and role = 'manager' order by id`;
}

/**
 * Req. 12.3 / 12.8: e-mails dos eventos de troca. Usuários inativos não recebem. O cancelamento
 * só avisa o colega se o pedido chegou a ser enviado a ele. Retorna quantos e-mails entraram na
 * outbox (a mesma chave não é enfileirada duas vezes).
 */
export async function notifySwapEvent(
  sql: Sql,
  event: SwapEvent,
  opts: { appBaseUrl?: string | undefined; now?: Date } = {},
): Promise<number> {
  const { swap } = event;
  const now = opts.now ?? new Date();
  const appUrl = opts.appBaseUrl ? new URL('/trocas', opts.appBaseUrl).href : undefined;

  const targets: { user: Recipient; audience: SwapEmailAudience }[] = [];
  const members = await activeUsers(sql, [swap.requesterId, swap.counterpartId]);
  const requester = members.get(swap.requesterId);
  const counterpart = members.get(swap.counterpartId);
  const add = (user: Recipient | undefined, audience: SwapEmailAudience) => {
    if (user) targets.push({ user, audience });
  };

  switch (event.type) {
    case 'requested':
      add(counterpart, 'counterpart');
      break;
    case 'accepted':
      add(requester, 'requester');
      for (const m of await activeManagers(sql)) add(m, 'manager');
      break;
    case 'declined':
      add(requester, 'requester');
      break;
    case 'cancelled': {
      const seen = await sql`
        select 1 from email_outbox where dedupe_key = ${`swap-requested:${swap.id}:counterpart`}`;
      if (seen.length > 0) add(counterpart, 'counterpart');
      break;
    }
    case 'approved':
    case 'rejected':
      add(requester, 'requester');
      add(counterpart, 'counterpart');
      break;
  }

  let queued = 0;
  for (const { user, audience } of targets) {
    const input: SwapEmailInput = {
      event: event.type,
      audience,
      swapKind: swap.kind,
      requesterName: swap.requesterName,
      counterpartName: swap.counterpartName,
      requesterShift: toShift(swap.requesterShift),
      counterpartShift: swap.counterpartShift ? toShift(swap.counterpartShift) : null,
      reason: event.type === 'rejected' ? (event.reason ?? swap.decisionReason) : null,
      appUrl,
      ...(audience === 'manager' ? { actionLabel: 'Abrir o Plantão360' } : {}),
    };
    const r = await enqueueEmail(
      sql,
      {
        to: user.email,
        ...renderSwapEmail(input),
        dedupeKey: `swap-${event.type}:${swap.id}:${audience === 'manager' ? user.id : audience}`,
      },
      now,
    );
    if (!r.duplicate) queued += 1;
  }
  return queued;
}

/** Gancho `onSwapEvent` do SwapsRouter. Falhas são registradas e não propagadas (pós-commit). */
export function createOnSwapEvent(deps: SwapEventsDeps): (event: SwapEvent) => Promise<void> {
  return async (event) => {
    try {
      await notifySwapEvent(deps.db, event, {
        appBaseUrl: deps.appBaseUrl,
        ...(deps.now ? { now: deps.now() } : {}),
      });
    } catch (err) {
      deps.logger?.error(
        { err, swapId: event.swap.id, type: event.type },
        'Falha ao enfileirar e-mails de troca',
      );
    }
  };
}
