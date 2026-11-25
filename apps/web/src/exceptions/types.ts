import { ApiError } from '../api/client';

export type ExceptionKind = 'vacation' | 'time_off' | 'other' | 'collective_vacation';

export interface Unavailability {
  id: string;
  userId: string | null;
  kind: ExceptionKind;
  startDate: string;
  endDate: string;
  note: string | null;
}

export interface ConflictWarning {
  type: 'published_shift_conflict';
  date: string;
  userId: string;
}

export interface ShiftsAffectedWarning {
  type: 'published_shifts_affected';
  date: string;
  count: number;
}

export type UnavailabilityWarning = ConflictWarning | ShiftsAffectedWarning;

export interface UnavailabilityMutation {
  unavailability: Unavailability;
  warnings?: UnavailabilityWarning[];
}

export interface MemberOption {
  id: string;
  name: string;
  active: boolean;
}

export interface FormValues {
  kind: ExceptionKind;
  startDate: string;
  endDate: string;
  note: string;
  userId: string;
  /** Só na tela de Férias: false = individual, true = coletiva. */
  collective: boolean;
  /** Coletiva: true = todo o time; false = só os `userIds`. */
  allTeam: boolean;
  userIds: string[];
}

export interface KindOption {
  value: Exclude<ExceptionKind, 'collective_vacation'>;
  label: string;
}

/** Férias têm tela própria; não são oferecidas ao cadastrar uma exceção. */
export const KIND_OPTIONS: KindOption[] = [
  { value: 'time_off', label: 'Folga' },
  { value: 'other', label: 'Outro' },
];

/** Registros antigos de férias ainda podem ser editados sem trocar o tipo. */
export const LEGACY_VACATION_OPTION: KindOption = { value: 'vacation', label: 'Férias' };

export const KIND_LABELS: Record<ExceptionKind, string> = {
  vacation: 'Férias',
  time_off: 'Folga',
  other: 'Outro',
  collective_vacation: 'Férias coletivas',
};

export const WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

export const MAX_CONSECUTIVE = 14;

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatPeriod(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} a ${formatDate(end)}`;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function validatePeriod(start: string, end: string): string | null {
  if (!start || !end) return 'Informe as datas inicial e final.';
  if (end < start) return 'A data final não pode ser anterior à data inicial.';
  return null;
}

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data final (inclusive) de um período de `days` dias que começa em `start`; null se inválido. */
export function endDateFor(start: string, days: number): string | null {
  if (!ISO.test(start) || !Number.isInteger(days) || days < 1) return null;
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + (days - 1) * DAY_MS);
  return Number.isNaN(end.getTime()) ? null : end.toISOString().slice(0, 10);
}

/** Quantidade de dias (inclusive) entre as datas; null se alguma for inválida ou o fim vier antes. */
export function countDays(start: string, end: string): number | null {
  if (!ISO.test(start) || !ISO.test(end) || end < start) return null;
  return (
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1
  );
}
