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

export const KIND_OPTIONS: {
  value: Exclude<ExceptionKind, 'collective_vacation'>;
  label: string;
}[] = [
  { value: 'vacation', label: 'Férias' },
  { value: 'time_off', label: 'Folga' },
  { value: 'other', label: 'Outro' },
];

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
