import { describe, expect, it } from 'vitest';
import { addMonths, buildMonthGrid, monthLabel, monthRange } from './calendar';
import { formatDayShort, formatPeriod, todayLocal } from './format';
import type { ShiftDto } from './types';

describe('calendar', () => {
  it('calcula o intervalo do mês, inclusive fevereiro bissexto', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('navega entre meses na virada de ano', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-03', -14)).toBe('2025-01');
  });

  it('monta a grade com semana iniciando na segunda', () => {
    const grid = buildMonthGrid('2028-02');
    expect(grid).toHaveLength(35);
    expect(grid.slice(0, 1)).toEqual([null]);
    expect(grid[1]).toBe('2028-02-01');
    expect(grid.filter(Boolean)).toHaveLength(29);
    expect(buildMonthGrid('2026-03')[6]).toBe('2026-03-01');
  });

  it('rotula o mês em português', () => {
    expect(monthLabel('2026-03')).toBe('março de 2026');
  });
});

describe('format', () => {
  it('formata data curta com dia da semana sem depender do fuso', () => {
    expect(formatDayShort('2026-03-02')).toBe('seg, 02 mar 2026');
    expect(formatDayShort('2028-02-29')).toBe('ter, 29 fev 2028');
  });

  it('calcula hoje no fuso de São Paulo', () => {
    expect(todayLocal(new Date('2026-03-10T02:00:00Z'))).toBe('2026-03-09');
  });

  it('exibe o período no fuso de São Paulo', () => {
    const base = {
      id: '1',
      scheduleId: 's',
      hours: 14,
      userId: 'u',
      userName: 'Ana',
      originalUserId: null,
      originalHours: null,
    };
    const weekday: ShiftDto = {
      ...base,
      date: '2026-03-02',
      dayType: 'weekday',
      startsAt: '2026-03-02T21:00:00.000Z',
      endsAt: '2026-03-03T11:00:00.000Z',
    };
    expect(formatPeriod(weekday)).toBe('18h–08h');
    expect(formatPeriod({ ...weekday, dayType: 'weekend', startsAt: null, endsAt: null })).toBe(
      '08h–08h',
    );
  });
});
