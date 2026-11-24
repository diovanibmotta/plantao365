import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_PERIODS,
  formatMinute,
  parseMinute,
  validateWorkPeriods,
  workMinutes,
} from './work-hours.js';

describe('work hours', () => {
  it('aceita a jornada padrão (08h00–12h00 | 13h30–18h00)', () => {
    expect(validateWorkPeriods(DEFAULT_WORK_PERIODS)).toBeNull();
    expect(workMinutes(DEFAULT_WORK_PERIODS)).toBe(8.5 * 60);
  });

  it('aceita jornada vazia', () => {
    expect(validateWorkPeriods([])).toBeNull();
  });

  it('rejeita fim antes do início, sobreposição e fora de faixa', () => {
    expect(validateWorkPeriods([{ startMinute: 600, endMinute: 600 }])).not.toBeNull();
    expect(
      validateWorkPeriods([
        { startMinute: 480, endMinute: 720 },
        { startMinute: 700, endMinute: 900 },
      ]),
    ).not.toBeNull();
    expect(validateWorkPeriods([{ startMinute: -1, endMinute: 60 }])).not.toBeNull();
    expect(validateWorkPeriods([{ startMinute: 0, endMinute: 1441 }])).not.toBeNull();
    expect(validateWorkPeriods([{ startMinute: 0.5, endMinute: 60 }])).not.toBeNull();
  });

  it('formata e interpreta HH:MM', () => {
    expect(formatMinute(810)).toBe('13:30');
    expect(formatMinute(1440)).toBe('24:00');
    expect(parseMinute('13:30')).toBe(810);
    expect(parseMinute('8:00')).toBe(480);
    expect(parseMinute('25:00')).toBeNull();
    expect(parseMinute('10:75')).toBeNull();
    expect(parseMinute('abc')).toBeNull();
  });
});
