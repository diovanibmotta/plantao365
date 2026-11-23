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

export const SHIFT_HOURS = {
  weekday: 14,
  weekend: 24,
  holiday: 24,
  collective_vacation: 0,
} as const satisfies Record<DayType, number>;

export interface DateInterval {
  start: LocalDate;
  end: LocalDate;
}

export interface ShiftContext {
  /** Datas de feriado (qualquer abrangência cadastrada). */
  holidays: Iterable<LocalDate>;
  /** Períodos de férias coletivas, inclusivos. */
  collectiveVacations: readonly DateInterval[];
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
  const base = { date: d, month: monthOf(d), dayType, hours: SHIFT_HOURS[dayType] };
  if (dayType === 'collective_vacation') return { ...base, start: null, end: null };
  const startHour = dayType === 'weekday' ? 18 : 8;
  return {
    ...base,
    start: localToInstant(d, startHour),
    end: localToInstant(addDays(d, 1), 8),
  };
}

export function shiftsForRange(from: LocalDate, to: LocalDate, ctx: ShiftContext): Shift[] {
  const holidays = new Set(ctx.holidays);
  const c = { ...ctx, holidays };
  return dateRange(from, to).map((d) => shiftForDate(d, c));
}
