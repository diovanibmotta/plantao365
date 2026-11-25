import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_PERIODS,
  formatMinute,
  findOverlap,
  parseMinute,
  sortWorkPeriods,
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

  it('não limita a quantidade de períodos nem exige ordem; encostar não é sobrepor', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      startMinute: i * 60,
      endMinute: i * 60 + 60,
    }));
    expect(validateWorkPeriods(many)).toBeNull();
    expect(validateWorkPeriods([...many].reverse())).toBeNull();
  });

  it('informa os períodos que se sobrepõem', () => {
    const message = validateWorkPeriods([
      { startMinute: 700, endMinute: 900 },
      { startMinute: 480, endMinute: 720 },
    ]);
    expect(message).toContain('08:00–12:00');
    expect(message).toContain('11:40–15:00');
  });

  it('encontra o período sobreposto ignorando o próprio índice', () => {
    const list = [
      { startMinute: 480, endMinute: 720 },
      { startMinute: 810, endMinute: 1080 },
    ];
    expect(findOverlap(list, { startMinute: 700, endMinute: 900 })).toEqual(list[0]);
    expect(findOverlap(list, { startMinute: 720, endMinute: 810 })).toBeNull();
    expect(findOverlap(list, { startMinute: 480, endMinute: 600 }, 0)).toBeNull();
    expect(sortWorkPeriods([list[1]!, list[0]!])).toEqual(list);
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
