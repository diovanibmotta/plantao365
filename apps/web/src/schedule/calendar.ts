import { addDays, dayOfWeek } from '@plantao365/shared';
import type { LocalDate } from '@plantao365/shared';

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

export const WEEK_HEADERS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

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

/** Grade do mês com semana começando no domingo; `null` completa as semanas. */
export function buildMonthGrid(month: MonthKey): Array<LocalDate | null> {
  const { from, to } = monthRange(month);
  const cells: Array<LocalDate | null> = [];
  for (let i = 0; i < dayOfWeek(from); i++) cells.push(null);
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export type CalendarView = 'month' | 'week' | 'day';

const WEEKDAYS_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** Domingo da semana que contém a data. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, -dayOfWeek(date));
}

/** Datas exibidas na visão: 7 dias (dom–sáb) na semana, 1 no dia. */
export function viewDates(view: 'week' | 'day', anchor: LocalDate): LocalDate[] {
  if (view === 'day') return [anchor];
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function dayLabel(date: LocalDate): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
  return `${WEEKDAYS_LONG[dayOfWeek(date)]}, ${Number(date.slice(8, 10))} de ${month} de ${date.slice(0, 4)}`;
}

/** Ex.: 22–28 de novembro de 2026 (ou 29 de nov. – 5 de dez. de 2026 ao cruzar o mês). */
export function weekLabel(anchor: LocalDate): string {
  const first = weekStart(anchor);
  const last = addDays(first, 6);
  const d = (x: LocalDate) => Number(x.slice(8, 10));
  const month = (x: LocalDate) => MONTHS[Number(x.slice(5, 7)) - 1] ?? '';
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${d(first)}–${d(last)} de ${month(last)} de ${last.slice(0, 4)}`;
  }
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${d(first)} de ${month(first)} – ${d(last)} de ${month(last)} de ${last.slice(0, 4)}`;
  }
  return `${d(first)} de ${month(first)} de ${first.slice(0, 4)} – ${d(last)} de ${month(last)} de ${last.slice(0, 4)}`;
}

export function viewLabel(view: CalendarView, anchor: LocalDate): string {
  if (view === 'month') return monthLabel(monthKeyOf(anchor));
  return view === 'week' ? weekLabel(anchor) : dayLabel(anchor);
}

/** Move a âncora em meses (visão mensal), semanas ou dias. */
export function shiftAnchor(view: CalendarView, anchor: LocalDate, delta: number): LocalDate {
  if (view === 'day') return addDays(anchor, delta);
  if (view === 'week') return addDays(anchor, delta * 7);
  const month = addMonths(monthKeyOf(anchor), delta);
  return `${month}-01`;
}

/** Intervalo a buscar; inclui o dia anterior para plantões que viram a meia-noite. */
export function viewRange(
  view: CalendarView,
  anchor: LocalDate,
): { from: LocalDate; to: LocalDate } {
  if (view === 'month') return monthRange(monthKeyOf(anchor));
  const dates = viewDates(view, anchor);
  return { from: addDays(dates[0]!, -1), to: dates[dates.length - 1]! };
}

export interface DaySegment {
  startMinute: number;
  endMinute: number;
}

/**
 * Trecho de um intervalo [início, fim] (data local + minuto) que cai em `date`.
 * Fim às 00:00 do dia seguinte encerra em 24:00 do dia anterior.
 */
export function segmentOnDate(
  date: LocalDate,
  start: { date: LocalDate; minute: number },
  end: { date: LocalDate; minute: number },
): DaySegment | null {
  if (date < start.date || date > end.date) return null;
  const startMinute = date === start.date ? start.minute : 0;
  const endMinute = date === end.date ? end.minute : 1440;
  return endMinute > startMinute ? { startMinute, endMinute } : null;
}
