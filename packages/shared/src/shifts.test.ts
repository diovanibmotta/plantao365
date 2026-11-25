import { describe, expect, it } from 'vitest';
import { addDays, dateRange, dayOfWeek, localToInstant, monthOf, parseLocalDate } from './dates.js';
import {
  classifyDay,
  shiftDuration,
  shiftForDate,
  shiftsForRange,
  type ShiftContext,
} from './shifts.js';

const ctx: ShiftContext = {
  holidays: ['2026-12-25', '2027-01-01', '2026-11-21'],
  collectiveVacations: [{ start: '2026-12-21', end: '2027-01-03' }],
};
const noVacation: ShiftContext = { holidays: ctx.holidays, collectiveVacations: [] };

describe('dates', () => {
  it('day of week matches the reference spreadsheet', () => {
    expect(dayOfWeek('2026-12-05')).toBe(6); // sábado
    expect(dayOfWeek('2026-12-07')).toBe(1); // segunda
    expect(dayOfWeek('2027-01-01')).toBe(5); // sexta
    expect(dayOfWeek('2028-02-29')).toBe(2); // terça, ano bissexto
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects invalid dates', () => {
    expect(() => parseLocalDate('2026-02-30')).toThrow(RangeError);
    expect(() => parseLocalDate('26-12-01')).toThrow(RangeError);
    expect(() => parseLocalDate('2026-13-01')).toThrow(RangeError);
  });

  it('builds inclusive ranges', () => {
    expect(dateRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('converts local time to UTC using America/Sao_Paulo', () => {
    expect(localToInstant('2026-12-07', 18).toISOString()).toBe('2026-12-07T21:00:00.000Z');
  });
});

describe('classifyDay', () => {
  it('classifies weekday, weekend, holiday', () => {
    expect(classifyDay('2026-12-07', noVacation)).toBe('weekday');
    expect(classifyDay('2026-12-05', noVacation)).toBe('weekend');
    expect(classifyDay('2026-12-25', noVacation)).toBe('holiday');
  });

  it('holiday on a weekend stays 24h (holiday wins)', () => {
    expect(classifyDay('2026-11-21', noVacation)).toBe('holiday');
  });

  it('collective vacation wins over weekend and holiday, bounds inclusive', () => {
    expect(classifyDay('2026-12-20', ctx)).toBe('weekend');
    expect(classifyDay('2026-12-21', ctx)).toBe('collective_vacation');
    expect(classifyDay('2026-12-26', ctx)).toBe('collective_vacation');
    expect(classifyDay('2026-12-25', ctx)).toBe('collective_vacation');
    expect(classifyDay('2027-01-03', ctx)).toBe('collective_vacation');
    expect(classifyDay('2027-01-04', ctx)).toBe('weekday');
  });
});

describe('shiftForDate', () => {
  it('weekday: 18h to 08h next day, 14 hours', () => {
    const s = shiftForDate('2026-12-07', noVacation);
    expect(s.hours).toBe(14);
    expect(s.start?.toISOString()).toBe('2026-12-07T21:00:00.000Z');
    expect(s.end?.toISOString()).toBe('2026-12-08T11:00:00.000Z');
    expect((s.end!.getTime() - s.start!.getTime()) / 3_600_000).toBe(14);
  });

  it('weekend and holiday: 08h to 08h next day, 24 hours', () => {
    for (const d of ['2026-12-05', '2026-12-25']) {
      const s = shiftForDate(d, noVacation);
      expect(s.hours).toBe(24);
      expect((s.end!.getTime() - s.start!.getTime()) / 3_600_000).toBe(24);
    }
    expect(shiftForDate('2026-12-05', noVacation).start?.toISOString()).toBe(
      '2026-12-05T11:00:00.000Z',
    );
  });

  it('collective vacation: 0 hours, no interval', () => {
    const s = shiftForDate('2026-12-26', ctx);
    expect(s).toMatchObject({ dayType: 'collective_vacation', hours: 0, start: null, end: null });
  });

  it('shift crossing month end counts in the start month', () => {
    const s = shiftForDate('2026-03-31', noVacation);
    expect(s.month).toBe('2026-03');
    expect(monthOf(s.date)).toBe('2026-03');
    expect(s.end?.toISOString()).toBe('2026-04-01T11:00:00.000Z');
  });

  it('assigns the shift to the start date across the year boundary', () => {
    const s = shiftForDate('2026-12-31', noVacation);
    expect(s.date).toBe('2026-12-31');
    expect(s.month).toBe('2026-12');
    expect(s.end?.toISOString()).toBe('2027-01-01T11:00:00.000Z');
  });
});

describe('configurable shift times', () => {
  const custom: ShiftContext = {
    ...noVacation,
    shiftTimes: {
      weekday: { startHour: 19, endHour: 7 },
      weekend: { startHour: 7, endHour: 19 },
      holiday: { startHour: 9, endHour: 9 },
    },
  };

  it('uses per-day-type hours, ending next day only when end <= start', () => {
    const weekday = shiftForDate('2026-12-07', custom);
    expect(weekday.hours).toBe(12);
    expect(weekday.start?.toISOString()).toBe('2026-12-07T22:00:00.000Z');
    expect(weekday.end?.toISOString()).toBe('2026-12-08T10:00:00.000Z');

    const weekend = shiftForDate('2026-12-05', custom);
    expect(weekend.hours).toBe(12);
    expect(weekend.end?.toISOString()).toBe('2026-12-05T22:00:00.000Z');

    const holiday = shiftForDate('2026-12-25', custom);
    expect(holiday.hours).toBe(24);
    expect(holiday.start?.toISOString()).toBe('2026-12-25T12:00:00.000Z');
  });

  it('computes durations', () => {
    expect(shiftDuration({ startHour: 18, endHour: 8 })).toBe(14);
    expect(shiftDuration({ startHour: 8, endHour: 8 })).toBe(24);
    expect(shiftDuration({ startHour: 8, endHour: 18 })).toBe(10);
  });
});

describe('shiftsForRange', () => {
  it('computes the hours of the spreadsheet week 7 to 13 Dec 2026', () => {
    const shifts = shiftsForRange('2026-12-07', '2026-12-13', noVacation);
    expect(shifts.map((s) => s.hours)).toEqual([14, 14, 14, 14, 14, 24, 24]);
  });

  it('is deterministic', () => {
    expect(shiftsForRange('2026-12-01', '2027-01-10', ctx)).toEqual(
      shiftsForRange('2026-12-01', '2027-01-10', ctx),
    );
  });
});

describe('shiftExceptions', () => {
  it('usa o horário da exceção na data e o padrão nas demais', () => {
    const ctx: ShiftContext = {
      ...noVacation,
      shiftExceptions: new Map([['2026-12-24', { startHour: 15, endHour: 8 }]]),
    };
    const eve = shiftForDate('2026-12-24', ctx);
    expect(eve.hours).toBe(17);
    expect(eve.start).toEqual(localToInstant('2026-12-24', 15));
    expect(eve.end).toEqual(localToInstant('2026-12-25', 8));
    expect(shiftForDate('2026-12-23', ctx).hours).toBe(14);
  });
});
