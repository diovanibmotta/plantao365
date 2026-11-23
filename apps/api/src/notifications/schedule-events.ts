import {
  enqueueEmail,
  renderSchedulePublishedEmail,
  renderShiftChangedEmail,
} from '../email/index.js';
import type { SqlOrTx } from '../email/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import type { PublishedEvent, ShiftChange } from '../schedules/index.js';

export interface ScheduleEventsDeps {
  db: Sql;
  /** URL base do web (APP_BASE_URL); habilita o link "Abrir minha escala" nos e-mails. */
  appBaseUrl?: string | undefined;
  now?: (() => Date) | undefined;
  logger?: Logger | undefined;
}

/** Alteração de um plantão de escala publicada (edição do gestor ou recálculo por feriado). */
export interface ShiftChangeNotice {
  shiftId: string;
  /** Data local AAAA-MM-DD. */
  date: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  hours: number;
  /** Horas antes; só relevante quando o responsável não mudou (recálculo). */
  previousHours?: number | null | undefined;
  previousUserId: string | null;
  newUserId: string | null;
  reason: string | null;
  /** Identifica esta alteração na chave de dedupe; por padrão, o instante da chamada. */
  changeKey?: string | undefined;
}

interface Recipient {
  id: string;
  name: string;
  email: string;
}

const toDate = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

async function activeRecipients(sql: SqlOrTx, ids: string[]): Promise<Map<string, Recipient>> {
  if (ids.length === 0) return new Map();
  const rows = await (sql as Sql)<Recipient[]>`
    select id, name, email from users where active and id in ${(sql as Sql)(ids)}`;
  return new Map(rows.map((r) => [r.id, r]));
}

const appUrl = (base: string | undefined) =>
  base ? new URL('/minha-escala', base).href : undefined;

/** Req. 12.1: cada membro com plantões na escala recebe os seus. Usuários inativos não recebem. */
export async function notifySchedulePublished(
  sql: SqlOrTx,
  event: PublishedEvent,
  opts: { appBaseUrl?: string | undefined; now?: Date } = {},
): Promise<number> {
  const byUser = new Map<string, PublishedEvent['shifts']>();
  for (const s of event.shifts) {
    if (!s.userId) continue;
    byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  }
  const recipients = await activeRecipients(sql, [...byUser.keys()]);
  let queued = 0;
  for (const [userId, shifts] of byUser) {
    const user = recipients.get(userId);
    if (!user) continue;
    const rendered = renderSchedulePublishedEmail({
      startDate: event.schedule.startDate,
      endDate: event.schedule.endDate,
      appUrl: appUrl(opts.appBaseUrl),
      shifts: [...shifts]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s) => ({
          date: s.date,
          startsAt: toDate(s.startsAt),
          endsAt: toDate(s.endsAt),
          hours: s.hours,
        })),
    });
    const r = await enqueueEmail(
      sql,
      {
        to: user.email,
        ...rendered,
        dedupeKey: `schedule-published:${event.schedule.id}:${userId}`,
      },
      opts.now,
    );
    if (!r.duplicate) queued += 1;
  }
  return queued;
}

/**
 * Req. 12.2 / 4.6: notifica quem perdeu e quem recebeu o plantão, com o motivo. Quando o
 * responsável é o mesmo e só as horas mudaram (recálculo de feriado), avisa o responsável.
 * Chamada pela task 4.3 com as alterações do recálculo.
 */
export async function notifyShiftsChanged(
  sql: SqlOrTx,
  changes: ShiftChangeNotice[],
  opts: { appBaseUrl?: string | undefined; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const ids = changes.flatMap((c) => [c.previousUserId, c.newUserId]).filter((x) => x !== null);
  const recipients = await activeRecipients(sql, [...new Set(ids)]);
  let queued = 0;

  for (const c of changes) {
    const changeKey = c.changeKey ?? now.toISOString();
    const shift = {
      date: c.date,
      startsAt: toDate(c.startsAt),
      endsAt: toDate(c.endsAt),
      hours: c.hours,
    };
    const targets: { userId: string | null; kind: 'lost' | 'received' | 'updated' }[] =
      c.previousUserId === c.newUserId
        ? c.previousHours != null && c.previousHours !== c.hours
          ? [{ userId: c.newUserId, kind: 'updated' }]
          : []
        : [
            { userId: c.previousUserId, kind: 'lost' },
            { userId: c.newUserId, kind: 'received' },
          ];

    for (const t of targets) {
      const user = t.userId ? recipients.get(t.userId) : undefined;
      if (!user) continue;
      const rendered = renderShiftChangedEmail({
        kind: t.kind,
        shift,
        previousHours: c.previousHours,
        reason: c.reason,
        appUrl: appUrl(opts.appBaseUrl),
      });
      const r = await enqueueEmail(
        sql,
        {
          to: user.email,
          ...rendered,
          dedupeKey: `shift-changed:${c.shiftId}:${t.kind}:${user.id}:${changeKey}`,
        },
        now,
      );
      if (!r.duplicate) queued += 1;
    }
  }
  return queued;
}

/** Gancho `onPublished` do SchedulesRouter. Falhas são registradas e não propagadas (pós-commit). */
export function createOnPublished(
  deps: ScheduleEventsDeps,
): (event: PublishedEvent) => Promise<void> {
  return async (event) => {
    try {
      await notifySchedulePublished(deps.db, event, {
        appBaseUrl: deps.appBaseUrl,
        ...(deps.now ? { now: deps.now() } : {}),
      });
    } catch (err) {
      deps.logger?.error(
        { err, scheduleId: event.schedule.id },
        'Falha ao enfileirar e-mails de publicação',
      );
    }
  };
}

/** Gancho `onShiftChanged` do SchedulesRouter: só escalas publicadas notificam. */
export function createOnShiftChanged(
  deps: ScheduleEventsDeps,
): (change: ShiftChange) => Promise<void> {
  return async (change) => {
    if (change.schedule.status !== 'published') return;
    try {
      await notifyShiftsChanged(
        deps.db,
        [
          {
            shiftId: change.shift.id,
            date: change.shift.date,
            startsAt: change.shift.startsAt,
            endsAt: change.shift.endsAt,
            hours: change.shift.hours,
            previousUserId: change.previousUserId,
            newUserId: change.newUserId,
            reason: change.reason,
          },
        ],
        { appBaseUrl: deps.appBaseUrl, ...(deps.now ? { now: deps.now() } : {}) },
      );
    } catch (err) {
      deps.logger?.error(
        { err, shiftId: change.shift.id },
        'Falha ao enfileirar e-mails de alteração',
      );
    }
  };
}
