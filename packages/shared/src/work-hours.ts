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

/** Períodos em ordem cronológica. */
export function sortWorkPeriods(periods: readonly WorkPeriod[]): WorkPeriod[] {
  return periods
    .map((p) => ({ ...p }))
    .sort((x, y) => x.startMinute - y.startMinute || x.endMinute - y.endMinute);
}

/** Dois períodos se sobrepõem quando compartilham algum minuto; encostar (fim = início) é permitido. */
export function periodsOverlap(a: WorkPeriod, b: WorkPeriod): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** Primeiro período da lista que se sobrepõe ao candidato (ignorando o índice informado). */
export function findOverlap(
  periods: readonly WorkPeriod[],
  candidate: WorkPeriod,
  ignoreIndex?: number,
): WorkPeriod | null {
  return periods.find((p, i) => i !== ignoreIndex && periodsOverlap(p, candidate)) ?? null;
}

/** Mensagem de sobreposição entre dois períodos. */
export const overlapMessage = (a: WorkPeriod, b: WorkPeriod): string =>
  `O período ${formatMinute(a.startMinute)}–${formatMinute(a.endMinute)} se sobrepõe ao período ${formatMinute(b.startMinute)}–${formatMinute(b.endMinute)}`;

/** Valida cada período e a ausência de sobreposição; não há limite de períodos nem exigência de ordem. */
export function validateWorkPeriods(periods: readonly WorkPeriod[]): string | null {
  for (const p of periods) {
    if (!Number.isInteger(p.startMinute) || !Number.isInteger(p.endMinute)) {
      return 'Horário inválido';
    }
    if (p.startMinute < 0 || p.endMinute > 1440) return 'Horário deve estar entre 00:00 e 24:00';
    if (p.endMinute <= p.startMinute) return 'O fim do período deve ser depois do início';
  }
  const sorted = sortWorkPeriods(periods);
  for (let i = 1; i < sorted.length; i++) {
    if (periodsOverlap(sorted[i - 1]!, sorted[i]!)) {
      return overlapMessage(sorted[i - 1]!, sorted[i]!);
    }
  }
  return null;
}

/** Exceção de horário em uma data: plantão e, opcionalmente, jornada do dia diferentes do padrão. */
export interface ShiftException {
  date: string;
  startHour: number;
  endHour: number;
  /** Jornada do dia; null mantém a jornada padrão da equipe. */
  workPeriods: WorkPeriod[] | null;
  note: string | null;
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
