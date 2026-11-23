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

export interface UserBalance extends BalanceTotals {
  userId: string;
  months: MonthBalance[];
}

export interface ShiftBalanceDetail {
  date: LocalDate;
  dayType: DayType;
  plannedHours: number;
  actualHours: number;
  status: 'upcoming' | 'done';
  swapped: boolean;
}

export interface AdjustmentDto {
  id: string;
  userId: string;
  date: LocalDate;
  hours: number;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface BalanceQuery {
  userId?: string | undefined;
  year: number;
  now: Date;
}
