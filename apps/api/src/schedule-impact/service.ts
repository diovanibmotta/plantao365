import { shiftForDate, type DayType, type ShiftContext } from '@diovanibmotta/plantao365-shared';
import type { Sql } from '../db.js';
import { publishEvent } from '../events/publisher.js';
import { listHolidayDates } from '../holidays/service.js';
import { getShiftExceptionTimes, getShiftTimes, getWeekdayTimes } from '../schedules/settings.js';
import { listUnavailableByDate } from '../unavailability/service.js';
import { impactMessage } from './message.js';
import type {
  ScheduleImpact,
  ScheduleImpactNotifier,
  ScheduleImpactPayload,
  ScheduleImpactTrigger,
  TeamImpact,
} from './types.js';

interface TeamDateRow {
  team_id: string;
  date: string;
}

function groupByTeam(rows: TeamDateRow[]): TeamImpact[] {
  const byTeam = new Map<string, string[]>();
  for (const r of rows) {
    const list = byTeam.get(r.team_id);
    if (list) list.push(r.date);
    else byTeam.set(r.team_id, [r.date]);
  }
  return [...byTeam.entries()]
    .map(([teamId, all]) => ({
      teamId,
      dates: [...new Set(all)].sort(),
      shifts: all.length,
    }))
    .sort((a, b) => a.teamId.localeCompare(b.teamId));
}

/** Plantões publicados de um membro dentro do período (qualquer equipe). */
async function memberShifts(sql: Sql, userId: string, start: string, end: string) {
  return sql<TeamDateRow[]>`
    select sc.team_id, s.date::text as date
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.user_id = ${userId}
      and s.date between ${start}::date and ${end}::date
    order by s.date`;
}

/** Plantões publicados (de todos os membros) no período, opcionalmente de uma só equipe. */
async function periodShifts(sql: Sql, start: string, end: string, teamId: string | null) {
  return sql<TeamDateRow[]>`
    select sc.team_id, s.date::text as date
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.date between ${start}::date and ${end}::date
      ${teamId ? sql`and sc.team_id = ${teamId}` : sql``}
    order by s.date`;
}

async function datesShifts(sql: Sql, dates: string[]) {
  if (dates.length === 0) return [];
  return sql<TeamDateRow[]>`
    select sc.team_id, s.date::text as date
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.date = any(${dates}::date[])
    order by s.date`;
}

interface FutureShiftRow {
  date: string;
  day_type: DayType;
  hours: number;
  starts_at: Date | null;
  ends_at: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Plantões publicados de hoje em diante cujo tipo de dia, horas ou horário divergem do que as
 * configurações atuais da equipe produziriam (mesma comparação do recálculo por feriado).
 */
async function settingsShifts(sql: Sql, teamId: string): Promise<TeamDateRow[]> {
  const rows = await sql<FutureShiftRow[]>`
    select s.date::text as date, s.day_type, s.hours, s.starts_at, s.ends_at
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and sc.team_id = ${teamId}
      and s.date >= (now() at time zone 'America/Sao_Paulo')::date
    order by s.date`;
  if (rows.length === 0) return [];
  const from = rows[0]!.date;
  const to = rows[rows.length - 1]!.date;
  const ctx: ShiftContext = {
    holidays: await listHolidayDates(sql, from, to),
    collectiveVacations: (await listUnavailableByDate(sql, from, to, teamId)).collectiveVacations,
    shiftTimes: await getShiftTimes(sql, teamId),
    weekdayTimes: await getWeekdayTimes(sql, teamId),
    shiftExceptions: await getShiftExceptionTimes(sql, teamId, from, to),
  };
  return rows
    .filter((r) => {
      const next = shiftForDate(r.date, ctx);
      return !(
        r.day_type === next.dayType &&
        r.hours === next.hours &&
        iso(r.starts_at) === iso(next.start) &&
        iso(r.ends_at) === iso(next.end)
      );
    })
    .map((r) => ({ team_id: teamId, date: r.date }));
}

/** Plantões publicados que a alteração invalida, agrupados por equipe. */
export async function assessScheduleImpact(
  sql: Sql,
  trigger: ScheduleImpactTrigger,
): Promise<TeamImpact[]> {
  switch (trigger.source) {
    case 'member_exception':
      return groupByTeam(await memberShifts(sql, trigger.userId, trigger.start, trigger.end));
    case 'collective_vacation':
      return groupByTeam(await periodShifts(sql, trigger.start, trigger.end, trigger.teamId));
    case 'holiday':
      return groupByTeam(await datesShifts(sql, [...new Set(trigger.dates)].sort()));
    case 'shift_times':
    case 'shift_exception':
      return groupByTeam(await settingsShifts(sql, trigger.teamId));
  }
}

function payloadFor(trigger: ScheduleImpactTrigger, teams: TeamImpact[]): ScheduleImpactPayload {
  const base = { source: trigger.source, actorId: trigger.actorId, teams };
  if (trigger.source === 'member_exception') {
    return { ...base, userId: trigger.userId, start: trigger.start, end: trigger.end };
  }
  if (trigger.source === 'collective_vacation') {
    return { ...base, start: trigger.start, end: trigger.end };
  }
  return base;
}

/**
 * Regra core: detecta se a alteração atinge escalas publicadas e, se sim, publica o evento
 * `schedule.impact` (e-mail aos gestores das equipes) na mesma transação e devolve o aviso da tela.
 */
export function createScheduleImpactNotifier(): ScheduleImpactNotifier {
  return async (sql, trigger) => {
    const teams = await assessScheduleImpact(sql, trigger);
    if (teams.length === 0) return null;
    await publishEvent(sql, 'schedule.impact', payloadFor(trigger, teams));
    const shifts = teams.reduce((sum, t) => sum + t.shifts, 0);
    const impact: ScheduleImpact = {
      source: trigger.source,
      shifts,
      dates: [...new Set(teams.flatMap((t) => t.dates))].sort(),
      teams,
      message: impactMessage(trigger.source, shifts),
    };
    return impact;
  };
}
