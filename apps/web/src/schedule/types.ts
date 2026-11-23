import type { DayType, LocalDate } from '@plantao360/shared';

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
  originalUserId: string | null;
  originalHours: number | null;
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
