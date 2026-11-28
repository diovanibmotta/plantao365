import { SHIFT_WEEKDAYS } from '@plantao365/shared';
import type { ShiftTime, ShiftTimes, WeekdayShiftTime } from '@plantao365/shared';

export { SHIFT_WEEKDAYS };

/** Nome do dia da semana (0 = domingo). */
export const WEEKDAY_NAME = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export const HOLIDAY_KEY = 'holiday';

/** Alvo de um horário: dia da semana (0 = domingo … 6 = sábado) ou feriado. */
export type ShiftTarget = number | typeof HOLIDAY_KEY;

/** Ordem de exibição: segunda a domingo, depois feriado. */
export const SHIFT_TARGETS: readonly ShiftTarget[] = [...SHIFT_WEEKDAYS, HOLIDAY_KEY];

export const targetLabel = (t: ShiftTarget): string =>
  t === HOLIDAY_KEY ? 'Feriado' : (WEEKDAY_NAME[t] ?? '');

/** Converte o parâmetro da rota (`0`–`6` ou `holiday`) no alvo; null se inválido. */
export function parseTarget(key: string | undefined): ShiftTarget | null {
  if (key === HOLIDAY_KEY) return HOLIDAY_KEY;
  const n = Number(key);
  return key !== undefined && key !== '' && Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
}

export interface EffectiveTime {
  time: ShiftTime;
  /** Horário cadastrado para o dia; falso quando vale o padrão do tipo de dia. */
  custom: boolean;
}

/** Horário que vale para o alvo: o cadastrado por dia da semana ou o padrão do tipo de dia. */
export function effectiveTime(
  target: ShiftTarget,
  times: ShiftTimes,
  weekdays: readonly WeekdayShiftTime[],
): EffectiveTime {
  if (target === HOLIDAY_KEY) return { time: times.holiday, custom: true };
  const own = weekdays.find((w) => w.weekday === target);
  if (own) return { time: { startHour: own.startHour, endHour: own.endHour }, custom: true };
  return { time: target === 0 || target === 6 ? times.weekend : times.weekday, custom: false };
}
