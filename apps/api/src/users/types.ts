import type { Role } from '../auth/index.js';
import type { Sql } from '../db.js';

export interface ProfileDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  participatesInRotation: boolean;
  remindersEnabled: boolean;
}

export interface UserListItemDto {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  linked: boolean;
  /** Equipes às quais o usuário está vinculado. */
  teamIds: string[];
}

export interface UpdateProfileInput {
  phone?: string | null;
  remindersEnabled?: boolean;
}

export interface CreateUserInput {
  name: string;
  email: string;
}

export interface UpdateUserInput {
  name?: string;
  active?: boolean;
}

export interface FutureShiftDto {
  shiftId: string;
  date: string;
  scheduleId: string;
  scheduleStart: string;
  scheduleEnd: string;
}

/** Injetado pelo app (findPublishedShiftsForUser de schedules) para evitar acoplamento circular. */
export type FutureShiftsFinder = (
  sql: Sql,
  args: { userId: string; start: string; end: string },
) => Promise<Array<{ date: string; userId: string | null }>>;
