import type { DayType, LocalDate } from '@plantao365/shared';

export interface ShiftDto {
  id: string;
  scheduleId: string;
  date: LocalDate;
  dayType: DayType;
  hours: number;
  startsAt: string | null;
  endsAt: string | null;
  userId: string | null;
  userName: string | null;
  userBadgeNumber?: string | null;
  originalUserId: string | null;
  originalHours: number | null;
  /** Motivos de conflito (só gestor, na escala aberta); vazio/ausente = sem conflito. */
  conflicts?: ShiftConflictDto[];
}

export interface ShiftConflictDto {
  code: 'member_unavailable' | 'collective_vacation' | 'outdated';
  message: string;
}

export interface HolidayDto {
  id: string;
  date: LocalDate;
  name: string;
  scope: string;
}

export interface UnavailabilityDto {
  id: string;
  userId: string | null;
  kind: string;
  startDate: LocalDate;
  endDate: LocalDate;
}
