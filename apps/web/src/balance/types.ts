import type { DayType, LocalDate } from '@diovanibmotta/plantao365-shared';

export interface MonthBalance {
  month: string;
  planned: number;
  actual: number;
  difference: number;
}

export interface BalanceTotals {
  planned: number;
  actual: number;
  difference: number;
}

export interface ShiftBalanceDetail {
  date: LocalDate;
  dayType: DayType;
  plannedHours: number;
  actualHours: number;
  status: 'upcoming' | 'done';
  swapped: boolean;
}

export interface MemberBalance {
  year: number;
  userId: string;
  months: MonthBalance[];
  total: BalanceTotals;
  shifts: ShiftBalanceDetail[];
}

export interface TeamMemberBalance extends BalanceTotals {
  userId: string;
  name: string;
  months: MonthBalance[];
}

export interface TeamBalanceData {
  year: number;
  members: TeamMemberBalance[];
}

export interface Adjustment {
  id: string;
  userId: string;
  date: LocalDate;
  hours: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}
