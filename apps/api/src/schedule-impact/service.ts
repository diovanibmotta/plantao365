import { shiftForDate, type DayType, type ShiftContext } from '@diovanibmotta/plantao365-shared';
import type { Sql } from '../db.js';
import { publishEvent } from '../events/publisher.js';
import { listHolidayDates } from '../holidays/service.js';
import { getShiftExceptionTimes, getShiftTimes, getWeekdayTimes } from '../schedules/settings.js';
import { listUnavailableByDate } from '../unavailability/service.js';
import { impactMessage } from './message.js';
import type {
  ScheduleConflicts,
  ShiftConflict,
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

async function datesShifts(sql: Sql, dates: string[], teamId: string | null = null) {
  if (dates.length === 0) return [];
  return sql<TeamDateRow[]>`
    select sc.team_id, s.date::text as date
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.status = 'published' and s.date = any(${dates}::date[])
      ${teamId ? sql`and sc.team_id = ${teamId}` : sql``}
    order by s.date`;
}

interface FutureShiftRow {
  id: string;
  schedule_id: string;
  date: string;
  day_type: DayType;
  hours: number;
  starts_at: Date | null;
  ends_at: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface OutdatedShift {
  id: string;
  schedule_id: string;
  date: string;
  current: { dayType: DayType; hours: number };
  next: { dayType: DayType; hours: number };
  sameTimes: boolean;
}

/**
 * Plantões de hoje em diante cujo tipo de dia, horas ou horário divergem do que as configurações
 * atuais da equipe produziriam (mesma comparação do recálculo por feriado). Sem `scheduleIds`,
 * vale para todas as escalas publicadas da equipe.
 */
async function outdatedShifts(
  sql: Sql,
  teamId: string,
  scheduleIds?: string[],
): Promise<OutdatedShift[]> {
  const rows = await sql<FutureShiftRow[]>`
    select s.id, s.schedule_id, s.date::text as date, s.day_type, s.hours, s.starts_at, s.ends_at
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.team_id = ${teamId}
      ${scheduleIds ? sql`and sc.id = any(${scheduleIds}::uuid[])` : sql`and sc.status = 'published'`}
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
  const outdated: OutdatedShift[] = [];
  for (const r of rows) {
    const next = shiftForDate(r.date, ctx);
    const sameTimes = iso(r.starts_at) === iso(next.start) && iso(r.ends_at) === iso(next.end);
    if (r.day_type === next.dayType && r.hours === next.hours && sameTimes) continue;
    outdated.push({
      id: r.id,
      schedule_id: r.schedule_id,
      date: r.date,
      current: { dayType: r.day_type, hours: r.hours },
      next: { dayType: next.dayType, hours: next.hours },
      sameTimes,
    });
  }
  return outdated;
}

const settingsShifts = async (sql: Sql, teamId: string): Promise<TeamDateRow[]> =>
  (await outdatedShifts(sql, teamId)).map((r) => ({ team_id: teamId, date: r.date }));

/**
 * Conflitos de cada escala (de hoje em diante): plantões em dia de exceção/férias do responsável
 * ou de férias coletivas, e plantões desatualizados em relação a feriados e horários atuais.
 */
export async function assessScheduleConflicts(
  sql: Sql,
  teamId: string,
  scheduleIds: string[],
): Promise<Map<string, ScheduleConflicts>> {
  const result = new Map<string, ScheduleConflicts>(
    scheduleIds.map((id) => [id, { unavailable: 0, outdated: 0 }]),
  );
  if (scheduleIds.length === 0) return result;
  const unavailable = await sql<{ schedule_id: string; n: number }[]>`
    select s.schedule_id, count(*)::int as n
    from shifts s join schedules sc on sc.id = s.schedule_id
    where sc.id = any(${scheduleIds}::uuid[]) and sc.team_id = ${teamId} and s.hours > 0
      and s.date >= (now() at time zone 'America/Sao_Paulo')::date
      and exists (
        select 1 from unavailabilities u
        where s.date between u.start_date and u.end_date
          and ((u.user_id is not null and u.user_id = s.user_id)
            or (u.user_id is null and (u.team_id is null or u.team_id = sc.team_id))))
    group by s.schedule_id`;
  for (const r of unavailable) result.get(r.schedule_id)!.unavailable = r.n;
  for (const r of await outdatedShifts(sql, teamId, scheduleIds)) {
    result.get(r.schedule_id)!.outdated += 1;
  }
  return result;
}

const DAY_TYPE_TEXT: Record<DayType, string> = {
  weekday: 'dia útil',
  weekend: 'fim de semana',
  holiday: 'feriado',
  collective_vacation: 'férias coletivas',
};

const KIND_TEXT: Record<string, string> = {
  vacation: 'férias',
  time_off: 'folga',
  other: 'exceção',
};

const brDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const brPeriod = (a: string, b: string) =>
  a === b ? `em ${brDate(a)}` : `de ${brDate(a)} a ${brDate(b)}`;

/** Motivos de conflito de cada plantão (de hoje em diante) de uma escala, por id do plantão. */
export async function assessShiftConflicts(
  sql: Sql,
  teamId: string,
  scheduleId: string,
): Promise<Map<string, ShiftConflict[]>> {
  const result = new Map<string, ShiftConflict[]>();
  const add = (shiftId: string, conflict: ShiftConflict) => {
    const list = result.get(shiftId);
    if (list) list.push(conflict);
    else result.set(shiftId, [conflict]);
  };
  const unavailable = await sql<
    { id: string; kind: string; user_name: string | null; start_date: string; end_date: string }[]
  >`
    select s.id, u.kind, m.name as user_name,
      u.start_date::text as start_date, u.end_date::text as end_date
    from shifts s
    join schedules sc on sc.id = s.schedule_id
    join unavailabilities u on s.date between u.start_date and u.end_date
      and ((u.user_id is not null and u.user_id = s.user_id)
        or (u.user_id is null and (u.team_id is null or u.team_id = sc.team_id)))
    left join users m on m.id = u.user_id
    where sc.id = ${scheduleId} and sc.team_id = ${teamId} and s.hours > 0
      and s.date >= (now() at time zone 'America/Sao_Paulo')::date
    order by s.date, u.start_date`;
  for (const r of unavailable) {
    const period = brPeriod(r.start_date, r.end_date);
    if (r.kind === 'collective_vacation') {
      add(r.id, {
        code: 'collective_vacation',
        message: `Dia em férias coletivas ${period}; o plantão não deveria existir.`,
      });
    } else {
      add(r.id, {
        code: 'member_unavailable',
        message: `${r.user_name ?? 'O responsável'} está de ${KIND_TEXT[r.kind] ?? 'exceção'} ${period}.`,
      });
    }
  }
  for (const r of await outdatedShifts(sql, teamId, [scheduleId])) {
    const diffs: string[] = [];
    if (r.current.dayType !== r.next.dayType) {
      diffs.push(
        `tipo de dia (${DAY_TYPE_TEXT[r.current.dayType]} na escala, ${DAY_TYPE_TEXT[r.next.dayType]} hoje)`,
      );
    }
    if (r.current.hours !== r.next.hours) {
      diffs.push(`horas (${r.current.hours}h na escala, ${r.next.hours}h hoje)`);
    }
    if (!r.sameTimes) diffs.push('horário de início e fim');
    add(r.id, {
      code: 'outdated',
      message: `Diferente da configuração atual de feriados e horários: ${diffs.join('; ')}.`,
    });
  }
  return result;
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
    case 'plugin':
      return groupByTeam(
        await datesShifts(sql, [...new Set(trigger.dates)].sort(), trigger.teamId),
      );
  }
}

function payloadFor(trigger: ScheduleImpactTrigger, teams: TeamImpact[]): ScheduleImpactPayload {
  const base = {
    source: trigger.source,
    actorId: trigger.actorId,
    teams,
    ...(trigger.removed && { removed: true }),
  };
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
      removed: trigger.removed === true,
      shifts,
      dates: [...new Set(teams.flatMap((t) => t.dates))].sort(),
      teams,
      message: impactMessage(trigger.source, shifts, trigger.removed === true),
    };
    return impact;
  };
}
