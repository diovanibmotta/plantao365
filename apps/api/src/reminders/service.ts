import type { Sql } from '../db.js';
import { enqueueEmail } from '../email/outbox.js';
import { formatDateShort, formatShiftPeriod, type ShiftSummary } from '../email/format.js';
import { renderEmail } from '../email/templates.js';
import type { Logger } from '../logger.js';

export interface RunRemindersOptions {
  now?: () => Date;
  leadHours?: number;
  appBaseUrl?: string;
  logger?: Logger;
}

export interface RunRemindersResult {
  enqueued: number;
  skipped: number;
}

interface ReminderRow {
  id: string;
  user_id: string;
  email: string;
  name: string;
  date: string;
  starts_at: Date;
  ends_at: Date;
  hours: number;
}

export function reminderDedupeKey(shiftId: string, userId: string): string {
  return `reminder:${shiftId}:${userId}`;
}

export function renderReminder(row: ShiftSummary & { name: string }, appBaseUrl?: string) {
  const day = formatDateShort(row.date).slice(0, 5);
  return renderEmail({
    subject: `Lembrete: plantão em ${day}`,
    heading: 'Lembrete de plantão',
    paragraphs: [
      `Olá, ${row.name}. Seu plantão começa em menos de 24 horas ` +
        `(${formatDateShort(row.date)}, ${formatShiftPeriod(row.startsAt, row.endsAt)}).`,
    ],
    shifts: [row],
    action: appBaseUrl ? { label: 'Abrir minha escala', url: appBaseUrl } : undefined,
  });
}

/**
 * Enfileira um lembrete por plantão publicado que começa nas próximas `leadHours` horas.
 * A janela é [agora, agora + lead]: plantões já iniciados não recebem; os que passam a existir
 * com menos de 24h de antecedência recebem na execução seguinte. A idempotência vem da
 * `dedupeKey` (shift + responsável), segura contra reexecuções e várias instâncias.
 */
export async function runReminders(
  sql: Sql,
  options: RunRemindersOptions = {},
): Promise<RunRemindersResult> {
  const { leadHours = 24, appBaseUrl, logger } = options;
  const now = (options.now ?? (() => new Date()))();
  const limit = new Date(now.getTime() + leadHours * 3_600_000);

  const rows = await sql<ReminderRow[]>`
    select s.id, s.user_id, u.email, u.name, to_char(s.date, 'YYYY-MM-DD') as date,
           s.starts_at, s.ends_at, s.hours::int as hours
    from shifts s
    join schedules sc on sc.id = s.schedule_id
    join users u on u.id = s.user_id
    where sc.status = 'published'
      and s.user_id is not null
      and s.hours > 0
      and s.starts_at > ${now}
      and s.starts_at <= ${limit}
      and u.active and u.reminders_enabled
      and not exists (
        select 1 from email_outbox o
        where o.dedupe_key = 'reminder:' || s.id::text || ':' || s.user_id::text)
    order by s.starts_at`;

  const result: RunRemindersResult = { enqueued: 0, skipped: 0 };
  for (const row of rows) {
    const rendered = renderReminder(
      {
        name: row.name,
        date: row.date,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        hours: row.hours,
      },
      appBaseUrl,
    );
    const { duplicate } = await enqueueEmail(
      sql,
      { to: row.email, ...rendered, dedupeKey: reminderDedupeKey(row.id, row.user_id) },
      now,
    );
    if (duplicate) result.skipped += 1;
    else result.enqueued += 1;
  }
  logger?.info({ ...result, candidates: rows.length }, 'Lembretes de plantão processados');
  return result;
}
