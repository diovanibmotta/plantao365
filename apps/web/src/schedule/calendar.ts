import { addDays, dayOfWeek } from '@plantao360/shared';
import type { LocalDate } from '@plantao360/shared';

/** Mês no formato AAAA-MM. */
export type MonthKey = string;

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export const WEEK_HEADERS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

export function monthKeyOf(date: LocalDate): MonthKey {
  return date.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(month: MonthKey): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
}

export function monthRange(month: MonthKey): { from: LocalDate; to: LocalDate } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const from = `${month}-01`;
  return { from, to: addDays(from, days - 1) };
}

/** Grade do mês com semana começando na segunda-feira; `null` completa as semanas. */
export function buildMonthGrid(month: MonthKey): Array<LocalDate | null> {
  const { from, to } = monthRange(month);
  const cells: Array<LocalDate | null> = [];
  for (let i = 0; i < (dayOfWeek(from) + 6) % 7; i++) cells.push(null);
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
