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
