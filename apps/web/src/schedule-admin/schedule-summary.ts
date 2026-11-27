import type { LocalDate } from '@diovanibmotta/plantao365-shared';
import type { ShiftDto } from '../schedule/types';

export interface MemberTotals {
  userId: string;
  name: string;
  shifts: number;
  hours: number;
  weekendHolidayShifts: number;
}

export interface ScheduleTotals {
  /** Dias que exigem responsável (exclui férias coletivas). */
  totalDays: number;
  unassignedDates: LocalDate[];
  members: MemberTotals[];
  /** Diferença entre a maior e a menor carga (horas) entre os membros com plantão. */
  spread: number;
  /** Carga média (horas) entre os membros com plantão. */
  average: number;
}

/** Totais por membro calculados a partir dos plantões gravados na escala. */
export function summarizeShifts(
  shifts: ShiftDto[],
  names: Map<string, string> = new Map(),
): ScheduleTotals {
  const byUser = new Map<string, MemberTotals>();
  const unassignedDates: LocalDate[] = [];
  let totalDays = 0;
  for (const s of shifts) {
    if (s.dayType === 'collective_vacation') continue;
    totalDays += 1;
    if (!s.userId) {
      unassignedDates.push(s.date);
      continue;
    }
    const entry = byUser.get(s.userId) ?? {
      userId: s.userId,
      name: s.userName ?? names.get(s.userId) ?? 'Membro',
      shifts: 0,
      hours: 0,
      weekendHolidayShifts: 0,
    };
    entry.shifts += 1;
    entry.hours += s.hours;
    if (s.dayType === 'weekend' || s.dayType === 'holiday') entry.weekendHolidayShifts += 1;
    byUser.set(s.userId, entry);
  }
  const members = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const hours = members.map((m) => m.hours);
  return {
    totalDays,
    unassignedDates,
    members,
    spread: hours.length > 0 ? Math.max(...hours) - Math.min(...hours) : 0,
    average: hours.length > 0 ? Math.round(hours.reduce((sum, h) => sum + h, 0) / hours.length) : 0,
  };
}
