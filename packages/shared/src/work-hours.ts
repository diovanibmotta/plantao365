/** Período da jornada de trabalho do time, em minutos desde 00:00 (início < fim, fim até 1440). */
export interface WorkPeriod {
  startMinute: number;
  endMinute: number;
}

/** Jornada padrão: 08h00–12h00 e 13h30–18h00. */
export const DEFAULT_WORK_PERIODS: readonly WorkPeriod[] = [
  { startMinute: 8 * 60, endMinute: 12 * 60 },
  { startMinute: 13 * 60 + 30, endMinute: 18 * 60 },
];

export const MAX_WORK_PERIODS = 6;

/** Retorna a mensagem do primeiro problema da jornada, ou null se válida. */
export function validateWorkPeriods(periods: readonly WorkPeriod[]): string | null {
  if (periods.length > MAX_WORK_PERIODS) {
    return `No máximo ${MAX_WORK_PERIODS} períodos`;
  }
  let previousEnd = 0;
  for (const p of periods) {
    if (!Number.isInteger(p.startMinute) || !Number.isInteger(p.endMinute)) {
      return 'Horário inválido';
    }
    if (p.startMinute < 0 || p.endMinute > 1440) return 'Horário deve estar entre 00:00 e 24:00';
    if (p.endMinute <= p.startMinute) return 'O fim do período deve ser depois do início';
    if (p.startMinute < previousEnd) return 'Períodos não podem se sobrepor e devem estar em ordem';
    previousEnd = p.endMinute;
  }
  return null;
}

/** Soma de minutos da jornada. */
export function workMinutes(periods: readonly WorkPeriod[]): number {
  return periods.reduce((acc, p) => acc + (p.endMinute - p.startMinute), 0);
}

/** Minutos desde 00:00 em "HH:MM" (24:00 permitido). */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" para minutos; null se inválido. */
export function parseMinute(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && minute <= 1440 ? minute : null;
}
