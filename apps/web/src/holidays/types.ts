import { dayOfWeek, parseLocalDate } from '@diovanibmotta/plantao365-shared';
import { ApiError } from '../api/client';

export type HolidayScope = 'national' | 'state' | 'municipal';

export interface Holiday {
  id: string;
  date: string;
  name: string;
  scope: HolidayScope;
}

export interface HolidayWarning {
  type: 'published_shifts_affected';
  date: string;
  count: number;
}

export interface RecalculateResult {
  updated: number;
  changes: unknown[];
}

export type HolidayMutation = Holiday & { warnings: HolidayWarning[] };

export interface HolidayFormValues {
  date: string;
  name: string;
  scope: HolidayScope;
}

export type HolidayFormErrors = Partial<Record<keyof HolidayFormValues, string>>;

export const SCOPES: { value: HolidayScope; label: string }[] = [
  { value: 'national', label: 'Nacional' },
  { value: 'state', label: 'Estadual' },
  { value: 'municipal', label: 'Municipal' },
];

export const NAME_MAX = 100;

export const EMPTY_FORM: HolidayFormValues = { date: '', name: '', scope: 'national' };

export function scopeLabel(scope: HolidayScope): string {
  return SCOPES.find((s) => s.value === scope)?.label ?? scope;
}

const WEEKDAYS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function formatDay(date: string): string {
  const [, month, day] = parseLocalDate(date).split('-').map(Number) as [number, number, number];
  return `${day} de ${MONTHS[month - 1]}`;
}

export function formatHolidayDate(date: string): string {
  return `${WEEKDAYS[dayOfWeek(date)]}, ${formatDay(date)}`;
}

export function validateForm(values: HolidayFormValues): HolidayFormErrors {
  const errors: HolidayFormErrors = {};
  if (!values.date) {
    errors.date = 'Informe a data.';
  } else {
    try {
      parseLocalDate(values.date);
    } catch {
      errors.date = 'Data inválida.';
    }
  }
  const name = values.name.trim();
  if (!name) errors.name = 'Informe o nome.';
  else if (name.length > NAME_MAX)
    errors.name = `O nome deve ter no máximo ${NAME_MAX} caracteres.`;
  return errors;
}

export function recalcSummary(updated: number): string {
  if (updated === 0) return 'Nenhum plantão mudou.';
  return updated === 1 ? '1 plantão recalculado.' : `${updated} plantões recalculados.`;
}

export function warningMessage(count: number): string {
  return count === 1
    ? '1 plantão publicado nesta data terá as horas alteradas — use “Recalcular horas”.'
    : `${count} plantões publicados nesta data terão as horas alteradas — use “Recalcular horas”.`;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; details?: unknown } | undefined;
    if (err.status === 409 || body?.error === 'duplicate_holiday') {
      return 'Já existe um feriado nesta data e abrangência.';
    }
    if (err.status === 404) return 'Feriado não encontrado. Atualize a lista.';
    if (body?.error === 'validation_error' && Array.isArray(body.details)) {
      return body.details.map(String).join(' ');
    }
  }
  return err instanceof Error ? err.message : fallback;
}
