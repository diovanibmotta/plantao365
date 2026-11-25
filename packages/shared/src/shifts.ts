import {
  type LocalDate,
  addDays,
  dateRange,
  isWeekend,
  localToInstant,
  monthOf,
  parseLocalDate,
} from './dates.js';

export type DayType = 'weekday' | 'weekend' | 'holiday' | 'collective_vacation';

/** Tipos de dia com plantão e horário configurável. */
export type ShiftDayType = Exclude<DayType, 'collective_vacation'>;

export const SHIFT_DAY_TYPES = ['weekday', 'weekend', 'holiday'] as const satisfies ShiftDayType[];

/** Horário do turno em horas cheias (0–23); fim menor ou igual ao início termina no dia seguinte. */
export interface ShiftTime {
  startHour: number;
  endHour: number;
}

export type ShiftTimes = Record<ShiftDayType, ShiftTime>;

export const DEFAULT_SHIFT_TIMES: ShiftTimes = {
  weekday: { startHour: 18, endHour: 8 },
  weekend: { startHour: 8, endHour: 8 },
  holiday: { startHour: 8, endHour: 8 },
};

/** Duração do turno; início igual ao fim é um plantão de 24h. */
export function shiftDuration({ startHour, endHour }: ShiftTime): number {
  return endHour > startHour ? endHour - startHour : endHour - startHour + 24;
}

/** Horário do turno de um dia: a exceção da data, se houver, senão o horário do tipo de dia. */
export function shiftTimeFor(
  date: LocalDate,
  dayType: ShiftDayType,
  ctx: Pick<ShiftContext, 'shiftTimes' | 'shiftExceptions'>,
): ShiftTime {
  return ctx.shiftExceptions?.get(date) ?? (ctx.shiftTimes ?? DEFAULT_SHIFT_TIMES)[dayType];
}

export function shiftHoursFor(
  date: LocalDate,
  dayType: DayType,
  ctx: Pick<ShiftContext, 'shiftTimes' | 'shiftExceptions'>,
): number {
  if (dayType === 'collective_vacation') return 0;
  return shiftDuration(shiftTimeFor(date, dayType, ctx));
}

export interface DateInterval {
  start: LocalDate;
  end: LocalDate;
}

export interface ShiftContext {
  /** Datas de feriado (qualquer abrangência cadastrada). */
  holidays: Iterable<LocalDate>;
  /** Períodos de férias coletivas, inclusivos. */
  collectiveVacations: readonly DateInterval[];
  /** Horário por tipo de dia; ausente usa DEFAULT_SHIFT_TIMES. */
  shiftTimes?: ShiftTimes | undefined;
  /** Exceções de horário por data (ex.: véspera de feriado com jornada reduzida). */
  shiftExceptions?: ReadonlyMap<LocalDate, ShiftTime> | undefined;
}

export interface Shift {
  /** Data de atribuição: data de início do turno. */
  date: LocalDate;
  /** Mês de atribuição das horas (AAAA-MM), a partir da data de início. */
  month: string;
  dayType: DayType;
  hours: number;
  /** Instantes UTC; nulos quando não há plantão (férias coletivas). */
  start: Date | null;
  end: Date | null;
}

/** Precedência: férias coletivas, feriado, fim de semana, dia útil. */
export function classifyDay(date: LocalDate, ctx: ShiftContext): DayType {
  const d = parseLocalDate(date);
  if (ctx.collectiveVacations.some((v) => d >= v.start && d <= v.end)) return 'collective_vacation';
  for (const h of ctx.holidays) if (h === d) return 'holiday';
  return isWeekend(d) ? 'weekend' : 'weekday';
}

export function shiftForDate(date: LocalDate, ctx: ShiftContext): Shift {
  const d = parseLocalDate(date);
  const dayType = classifyDay(d, ctx);
  const base = { date: d, month: monthOf(d), dayType, hours: shiftHoursFor(d, dayType, ctx) };
  if (dayType === 'collective_vacation') return { ...base, start: null, end: null };
  const time = shiftTimeFor(d, dayType, ctx);
  const endDate = time.endHour > time.startHour ? d : addDays(d, 1);
  return {
    ...base,
    start: localToInstant(d, time.startHour),
    end: localToInstant(endDate, time.endHour),
  };
}

export function shiftsForRange(from: LocalDate, to: LocalDate, ctx: ShiftContext): Shift[] {
  const holidays = new Set(ctx.holidays);
  const c = { ...ctx, holidays };
  return dateRange(from, to).map((d) => shiftForDate(d, c));
}
