import { z } from 'zod';
import { shiftForDate, type DayType } from '@diovanibmotta/plantao365-shared';
import { recordAudit } from '../audit/index.js';
import type { Sql } from '../db.js';
import type { Logger } from '../logger.js';
import { notifyShiftsChanged } from '../notifications/schedule-events.js';
import { runHookInSavepoint } from '../schedules/hook.js';
import { lockSchedulesThenShifts } from '../schedules/service.js';
import { listUnavailableByDate } from '../unavailability/service.js';
import { listHolidayDates, localDate } from './service.js';

export const RECALC_REASON = 'Recálculo por feriado';
export const MAX_RECALC_DATES = 366;

export const recalculateBodySchema = z.object({
  dates: z
    .array(localDate)
    .min(1, 'Informe ao menos uma data')
    .max(MAX_RECALC_DATES, 'Datas demais'),
});

export interface ShiftRecalcChange {
  shiftId: string;
  scheduleId: string;
  date: string;
  userId: string | null;
  previousDayType: DayType;
  dayType: DayType;
  previousHours: number;
  hours: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Versão da mudança (updated_at do plantão com microssegundos); discrimina a notificação. */
  version: string;
}

/**
 * Ponto de extensão: notifica responsáveis (Req. 4.6, 12.2). Roda DENTRO da transação do recálculo
 * (savepoint), com o `sql` da transação; falha não aborta o recálculo.
 */
export type ShiftsRecalculatedHook = (
  changes: ShiftRecalcChange[],
  sql: Sql,
) => void | Promise<void>;

interface Row {
  id: string;
  schedule_id: string;
  date: string;
  day_type: DayType;
  hours: number;
  starts_at: Date | null;
  ends_at: Date | null;
  user_id: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Recalcula tipo de dia, horas e horário dos plantões de escalas publicadas nas datas, com os
 * feriados e férias coletivas atuais, em uma transação. original_* não é alterado.
 */
export async function recalculateHolidayShifts(
  db: Sql,
  input: { dates: string[]; actorId: string },
  onChanges?: ShiftsRecalculatedHook | undefined,
): Promise<ShiftRecalcChange[]> {
  const dates = [...new Set(input.dates)].sort();
  return db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    await lockSchedulesThenShifts(tx, { publishedDates: dates });
    const rows = await tx<Row[]>`
      select s.id, s.schedule_id, s.date::text as date, s.day_type, s.hours,
        s.starts_at, s.ends_at, s.user_id
      from shifts s join schedules sc on sc.id = s.schedule_id
      where sc.status = 'published' and s.date in ${tx(dates)}
      order by s.date, s.id`;
    if (rows.length === 0) return [];
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const ctx = {
      holidays: await listHolidayDates(tx, from, to),
      collectiveVacations: (await listUnavailableByDate(tx, from, to)).collectiveVacations.map(
        (v) => ({ start: v.start, end: v.end }),
      ),
    };
    const changes: ShiftRecalcChange[] = [];
    const scheduleIds = new Set<string>();
    for (const r of rows) {
      const next = shiftForDate(r.date, ctx);
      const startsAt = next.start;
      const endsAt = next.end;
      const same =
        r.day_type === next.dayType &&
        r.hours === next.hours &&
        iso(r.starts_at) === iso(startsAt) &&
        iso(r.ends_at) === iso(endsAt);
      if (same) continue;
      const [upd] = await tx<{ version: string }[]>`
        update shifts set day_type = ${next.dayType}, hours = ${next.hours},
          starts_at = ${startsAt}, ends_at = ${endsAt}, updated_at = now()
        where id = ${r.id}
        returning updated_at::text as version`;
      scheduleIds.add(r.schedule_id);
      const change: ShiftRecalcChange = {
        shiftId: r.id,
        scheduleId: r.schedule_id,
        date: r.date,
        userId: r.user_id,
        previousDayType: r.day_type,
        dayType: next.dayType,
        previousHours: r.hours,
        hours: next.hours,
        startsAt: iso(startsAt),
        endsAt: iso(endsAt),
        version: upd!.version,
      };
      changes.push(change);
      await recordAudit(tx, {
        actorId: input.actorId,
        action: 'shift.holiday_recalc',
        entityType: 'shift',
        entityId: r.id,
        before: { scheduleId: r.schedule_id, date: r.date, dayType: r.day_type, hours: r.hours },
        after: {
          scheduleId: r.schedule_id,
          date: r.date,
          dayType: next.dayType,
          hours: next.hours,
        },
        reason: RECALC_REASON,
      });
    }
    if (scheduleIds.size > 0) {
      await tx`update schedules set updated_at = now() where id in ${tx([...scheduleIds])}`;
    }
    if (changes.length > 0 && onChanges) {
      await runHookInSavepoint(tx, (sp) => onChanges(changes, sp));
    }
    return changes;
  });
}

/** Gancho `onShiftsRecalculated`: só mudanças de horas notificam; falhas são registradas. */
export function createOnShiftsRecalculated(deps: {
  db: Sql;
  appBaseUrl?: string | undefined;
  logger?: Logger | undefined;
}): ShiftsRecalculatedHook {
  return async (changes, sql = deps.db) => {
    const notices = changes
      .filter((c) => c.previousHours !== c.hours)
      .map((c) => ({
        shiftId: c.shiftId,
        date: c.date,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        hours: c.hours,
        previousHours: c.previousHours,
        previousUserId: c.userId,
        newUserId: c.userId,
        reason: RECALC_REASON,
        changeKey: `holiday-recalc:${c.date}:${c.previousDayType}>${c.dayType}:${c.version}`,
      }));
    if (notices.length === 0) return;
    try {
      await notifyShiftsChanged(sql, notices, { appBaseUrl: deps.appBaseUrl });
    } catch (err) {
      deps.logger?.error({ err }, 'Falha ao enfileirar e-mails de recálculo por feriado');
      throw err;
    }
  };
}
