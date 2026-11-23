/** Fuso padrão do sistema (RNF-4). */
export const TIME_ZONE = 'America/Sao_Paulo';

/** Data local no formato AAAA-MM-DD. */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: LocalDate): [number, number, number] {
  const m = LOCAL_DATE.exec(date);
  if (!m) throw new RangeError(`Data inválida: ${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Data inválida: ${date}`);
  }
  return [y, mo, d];
}

function format(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Valida e normaliza uma data local; lança RangeError se inválida. */
export function parseLocalDate(date: string): LocalDate {
  const [y, m, d] = parts(date);
  return format(Date.UTC(y, m - 1, d));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = parts(date);
  return format(Date.UTC(y, m - 1, d + days));
}

/** 0 = domingo ... 6 = sábado. */
export function dayOfWeek(date: LocalDate): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(date: LocalDate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

/** Mês de atribuição (AAAA-MM) de uma data. */
export function monthOf(date: LocalDate): string {
  parts(date);
  return date.slice(0, 7);
}

/** Datas de `from` a `to`, inclusive. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const end = parseLocalDate(to);
  for (let d = parseLocalDate(from); d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function offsetMinutes(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    p['year']!,
    p['month']! - 1,
    p['day']!,
    p['hour']!,
    p['minute']!,
    p['second']!,
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** Converte data e hora locais do fuso em um instante UTC. */
export function localToInstant(
  date: LocalDate,
  hour: number,
  minute = 0,
  timeZone: string = TIME_ZONE,
): Date {
  const [y, m, d] = parts(date);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let instant = guess - offsetMinutes(guess, timeZone) * 60000;
  const second = offsetMinutes(instant, timeZone);
  instant = guess - second * 60000;
  return new Date(instant);
}
