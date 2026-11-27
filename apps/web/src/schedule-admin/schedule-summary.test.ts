import { describe, expect, it } from 'vitest';
import type { ShiftDto } from '../schedule/types';
import { summarizeShifts } from './schedule-summary';

const shift = (
  date: string,
  dayType: ShiftDto['dayType'],
  userId: string | null,
  hours = 14,
): ShiftDto => ({
  id: `sh-${date}`,
  scheduleId: 's1',
  date,
  dayType,
  hours,
  startsAt: null,
  endsAt: null,
  userId,
  userName: userId ? `Nome ${userId}` : null,
  originalUserId: null,
  originalHours: null,
});

describe('summarizeShifts', () => {
  it('soma plantões, horas e fins de semana/feriados por membro', () => {
    const totals = summarizeShifts([
      shift('2027-01-01', 'holiday', 'u1', 24),
      shift('2027-01-02', 'weekend', 'u2', 24),
      shift('2027-01-04', 'weekday', 'u1'),
      shift('2027-01-05', 'weekday', null),
      shift('2027-01-06', 'collective_vacation', null, 0),
    ]);
    expect(totals.totalDays).toBe(4);
    expect(totals.unassignedDates).toEqual(['2027-01-05']);
    expect(totals.members).toEqual([
      { userId: 'u1', name: 'Nome u1', shifts: 2, hours: 38, weekendHolidayShifts: 1 },
      { userId: 'u2', name: 'Nome u2', shifts: 1, hours: 24, weekendHolidayShifts: 1 },
    ]);
    expect(totals.spread).toBe(14);
    expect(totals.average).toBe(31);
  });

  it('retorna zeros sem plantões', () => {
    expect(summarizeShifts([])).toMatchObject({ totalDays: 0, spread: 0, average: 0, members: [] });
  });
});
