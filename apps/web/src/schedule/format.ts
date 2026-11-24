import { TIME_ZONE, addDays, dayOfWeek } from '@diovanibmotta/plantao365-shared';
import type { DayType, LocalDate, ShiftTime } from '@diovanibmotta/plantao365-shared';
import type { HolidayDto, ShiftDto } from './types';

const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: 'Dia útil',
  weekend: 'Fim de semana',
  holiday: 'Feriado',
  collective_vacation: 'Férias coletivas',
};

export function todayLocal(now: Date = new Date()): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function formatDayShort(date: LocalDate): string {
  const day = date.slice(8, 10);
  const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? '';
  return `${WEEKDAYS_SHORT[dayOfWeek(date)]}, ${day} ${month} ${date.slice(0, 4)}`;
}

function formatHour(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

export function formatPeriod(shift: ShiftDto): string {
  if (shift.dayType === 'collective_vacation' && !shift.startsAt) return 'Sem plantão';
  if (shift.startsAt && shift.endsAt) {
    return `${formatHour(shift.startsAt)}–${formatHour(shift.endsAt)}`;
  }
  return shift.dayType === 'weekday' ? '18:00–08:00' : '08:00–08:00';
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Ex.: 18:00–08:00; fim menor ou igual ao início indica o dia seguinte. */
export function formatShiftTime({ startHour, endHour }: ShiftTime): string {
  return `${hh(startHour)}–${hh(endHour)}`;
}

export function formatHours(hours: number): string {
  return `${hours}h`;
}

export function holidayMap(items: readonly HolidayDto[]): Map<LocalDate, string> {
  const map = new Map<LocalDate, string>();
  for (const h of items) {
    const current = map.get(h.date);
    map.set(h.date, current ? `${current}, ${h.name}` : h.name);
  }
  return map;
}

export function sumHours(shifts: readonly ShiftDto[], from: LocalDate, days: number): number {
  const to = addDays(from, days - 1);
  return shifts.filter((s) => s.date >= from && s.date <= to).reduce((acc, s) => acc + s.hours, 0);
}

/** Data e minuto do dia, no fuso do sistema, de um instante ISO. */
export function localDateMinute(iso: string): { date: LocalDate; minute: number } {
  const instant = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { date: todayLocal(instant), minute: get('hour') * 60 + get('minute') };
}
