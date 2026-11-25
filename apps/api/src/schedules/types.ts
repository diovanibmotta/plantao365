import type { DayType, LocalDate } from '@diovanibmotta/plantao365-shared';

export type ScheduleStatus = 'draft' | 'published';
export type ShiftStatusFilter = ScheduleStatus | 'all';

export interface ScheduleDto {
  id: string;
  startDate: LocalDate;
  endDate: LocalDate;
  status: ScheduleStatus;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  userBadgeNumber: string | null;
  originalUserId: string | null;
  originalHours: number | null;
}

export interface ShiftRangeQuery {
  from: LocalDate;
  to: LocalDate;
  status?: ShiftStatusFilter;
  userId?: string;
  /** Limita aos plantões de escalas desta equipe. */
  teamId?: string;
}
