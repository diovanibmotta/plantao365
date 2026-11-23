import type { Sql } from '../db.js';

export const MEMBER_KINDS = ['vacation', 'time_off', 'other'] as const;
export const UNAVAILABILITY_KINDS = [...MEMBER_KINDS, 'collective_vacation'] as const;

export type UnavailabilityKind = (typeof UNAVAILABILITY_KINDS)[number];

export interface UnavailabilityDto {
  id: string;
  userId: string | null;
  kind: UnavailabilityKind;
  startDate: string;
  endDate: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictWarning {
  type: 'published_shift_conflict';
  date: string;
  userId: string;
}

/** Férias coletivas sobre dias que já têm plantões publicados (Req. 5.6). */
export interface ShiftsAffectedWarning {
  type: 'published_shifts_affected';
  date: string;
  count: number;
}

export type UnavailabilityWarning = ConflictWarning | ShiftsAffectedWarning;

/** Evento do gancho `onConflict`: exceção de membro que conflita com plantão publicado. */
export interface UnavailabilityConflictEvent {
  unavailabilityId: string;
  userId: string;
  startDate: string;
  endDate: string;
  /** Datas em conflito (ordenadas, sem repetição). */
  dates: string[];
  /** Quem criou/editou a exceção. */
  actorId: string;
}

/** Contagem de plantões publicados por data (ex.: countPublishedShiftsOnDates). */
export type CollectiveImpactChecker = (
  sql: Sql,
  dates: string[],
) => Promise<Array<{ date: string; count: number }>>;

export interface ConflictArgs {
  userId: string | null;
  start: string;
  end: string;
}

export type ConflictChecker = (
  sql: Sql,
  args: ConflictArgs,
) => Promise<Array<{ date: string; userId: string }>>;

export interface UnavailableByDate {
  collectiveVacations: Array<{ start: string; end: string }>;
  byUser: Map<string, string[]>;
}
