import type { LocalDate } from '@diovanibmotta/plantao365-shared';
import { ApiError } from '../api/client';
import type { ShiftDto } from '../schedule/types';

export interface ScheduleDto {
  /** Conflitos da escala (só na listagem do gestor). */
  conflicts?: { unavailable: number; outdated: number };
  id: string;
  startDate: LocalDate;
  endDate: LocalDate;
  status: 'draft' | 'published';
  publishedAt: string | null;
}

export interface ScheduleDetail extends ScheduleDto {
  shifts: ShiftDto[];
}

export interface MemberOption {
  id: string;
  name: string;
  active: boolean;
}

export interface GenerateResult {
  schedule: ScheduleDto;
  shifts: ShiftDto[];
  unassignedDates: LocalDate[];
  preferenceViolations: Array<{
    date: LocalDate;
    userId: string;
    kind: 'avoid_weekday' | 'max_consecutive';
  }>;
  summary: Array<{ userId: string; hours: number; weekendHolidayShifts: number; shifts: number }>;
}

export interface ShiftWarning {
  code: string;
  message: string;
}

export interface EditResult {
  shift: ShiftDto;
  warnings: ShiftWarning[];
  notice?: string;
}

export const VIOLATION_LABEL = {
  avoid_weekday: 'dia da semana que prefere evitar',
  max_consecutive: 'limite de plantões consecutivos excedido',
} as const;

export function formatDate(date: LocalDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export function errorCode(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const code = (err.body as { error?: unknown }).error;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

export function errorDates(err: unknown): LocalDate[] {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const dates = (err.body as { unassignedDates?: unknown }).unassignedDates;
    if (Array.isArray(dates)) return dates.map(String);
  }
  return [];
}

export function describe(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
