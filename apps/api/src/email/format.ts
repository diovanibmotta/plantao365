export const TIME_ZONE = 'America/Sao_Paulo';

const dateLong = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateShort = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
});
const localDate = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIME_ZONE,
});

function fromIsoDate(isoDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Data inválida: ${isoDate}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** "sábado, 14 de março de 2026" a partir de uma data local AAAA-MM-DD. */
export function formatDate(isoDate: string): string {
  return dateLong.format(fromIsoDate(isoDate));
}

/** "14/03/2026" a partir de uma data local AAAA-MM-DD. */
export function formatDateShort(isoDate: string): string {
  return dateShort.format(fromIsoDate(isoDate));
}

/** Data local (America/Sao_Paulo) de um instante, no formato AAAA-MM-DD. */
export function localIsoDate(instant: Date): string {
  return localDate.format(instant);
}

/** "08:00" no fuso America/Sao_Paulo. */
export function formatTime(instant: Date): string {
  return time.format(instant);
}

/** "12 h" ou "7,5 h". */
export function formatHours(hours: number): string {
  return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
}

/** "01/03/2026 a 31/03/2026", ou só a data quando início e fim coincidem. */
export function formatDateRange(startIso: string, endIso: string): string {
  return startIso === endIso
    ? formatDateShort(startIso)
    : `${formatDateShort(startIso)} a ${formatDateShort(endIso)}`;
}

export interface ShiftSummary {
  /** Data do plantão (data local AAAA-MM-DD). */
  date: string;
  startsAt: Date;
  endsAt: Date;
  hours: number;
}

/** "das 20:00 às 08:00 (dia seguinte)" ou "das 08:00 às 20:00". */
export function formatShiftPeriod(startsAt: Date, endsAt: Date): string {
  const next = localIsoDate(endsAt) !== localIsoDate(startsAt);
  return `das ${formatTime(startsAt)} às ${formatTime(endsAt)}${next ? ' (dia seguinte)' : ''}`;
}

/** Linha completa de um plantão: data, período e horas. */
export function formatShift(shift: ShiftSummary): string {
  return `${formatDate(shift.date)}, ${formatShiftPeriod(shift.startsAt, shift.endsAt)}, ${formatHours(shift.hours)}`;
}
