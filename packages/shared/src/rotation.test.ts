import { describe, expect, it } from 'vitest';
import { addDays, dateRange } from './dates.js';
import {
  type RotationInput,
  type RotationMember,
  type RotationOutput,
  generateRotation,
} from './rotation.js';

const noPrefs = { avoidWeekdays: [], maxConsecutiveShifts: null };

function member(id: string, extra: Partial<RotationMember> = {}): RotationMember {
  return {
    id,
    active: true,
    participatesInRotation: true,
    unavailableDates: [],
    preferences: noPrefs,
    history: { hoursDone: 0, weekendHolidayShiftsDone: 0 },
    ...extra,
  };
}

function input(members: RotationMember[], extra: Partial<RotationInput> = {}): RotationInput {
  return {
    from: '2026-03-02',
    to: '2026-03-31',
    shiftContext: { holidays: [], collectiveVacations: [] },
    members,
    ...extra,
  };
}

const hoursOf = (out: RotationOutput, id: string): number =>
  out.summary.find((s) => s.userId === id)!.hours;

describe('generateRotation', () => {
  it('atribui um responsável por dia com dayType e horas', () => {
    const out = generateRotation(input([member('a'), member('b')], { to: '2026-03-08' }));
    expect(out.shifts).toHaveLength(7);
    expect(out.shifts[0]).toMatchObject({ date: '2026-03-02', dayType: 'weekday', hours: 14 });
    expect(out.shifts[5]).toMatchObject({ date: '2026-03-07', dayType: 'weekend', hours: 24 });
    expect(out.shifts.every((s) => s.userId !== null)).toBe(true);
    expect(out.unassignedDates).toEqual([]);
  });

  it('nunca aloca inativo, fora do rodízio ou com exceção na data', () => {
    const days = dateRange('2026-03-02', '2026-03-31');
    const out = generateRotation(
      input([
        member('a', { active: false }),
        member('b', { participatesInRotation: false }),
        member('c', { unavailableDates: days.slice(0, 15) }),
        member('d', { unavailableDates: days.slice(15) }),
      ]),
    );
    for (const s of out.shifts) {
      expect(['a', 'b']).not.toContain(s.userId);
      if (s.userId === 'c') expect(days.indexOf(s.date)).toBeGreaterThanOrEqual(15);
      if (s.userId === 'd') expect(days.indexOf(s.date)).toBeLessThan(15);
    }
    expect(out.unassignedDates).toEqual([]);
  });

  it('férias coletivas: 0h, sem responsável e fora de unassignedDates', () => {
    const out = generateRotation(
      input([member('a')], {
        shiftContext: {
          holidays: [],
          collectiveVacations: [{ start: '2026-03-10', end: '2026-03-12' }],
        },
      }),
    );
    for (const date of ['2026-03-10', '2026-03-11', '2026-03-12']) {
      const s = out.shifts.find((x) => x.date === date)!;
      expect(s).toEqual({ date, userId: null, dayType: 'collective_vacation', hours: 0 });
    }
    expect(out.unassignedDates).toEqual([]);
    expect(hoursOf(out, 'a')).toBe(out.shifts.reduce((t, s) => t + s.hours, 0));
  });

  it('dia sem elegível fica sem responsável e é sinalizado', () => {
    const out = generateRotation(
      input([member('a', { unavailableDates: ['2026-03-04'] })], { to: '2026-03-06' }),
    );
    expect(out.shifts.find((s) => s.date === '2026-03-04')!.userId).toBeNull();
    expect(out.unassignedDates).toEqual(['2026-03-04']);
    expect(generateRotation(input([], { to: '2026-03-03' })).unassignedDates).toEqual([
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('equilibra horas com diferença máxima limitada', () => {
    const members = ['a', 'b', 'c', 'd', 'e'].map((id) => member(id));
    const out = generateRotation(input(members, { from: '2026-03-01', to: '2026-04-30' }));
    const hours = out.summary.map((s) => s.hours);
    expect(Math.max(...hours) - Math.min(...hours)).toBeLessThanOrEqual(24);
  });

  it('considera o histórico: quem já fez mais horas recebe menos', () => {
    const out = generateRotation(
      input([
        member('a', { history: { hoursDone: 400, weekendHolidayShiftsDone: 8 } }),
        member('b'),
      ]),
    );
    expect(hoursOf(out, 'b')).toBeGreaterThan(hoursOf(out, 'a'));
  });

  it('balanceia fins de semana e feriados', () => {
    const members = ['a', 'b', 'c', 'd'].map((id) => member(id));
    const out = generateRotation(
      input(members, {
        from: '2026-03-01',
        to: '2026-05-31',
        shiftContext: {
          holidays: ['2026-04-03', '2026-04-21', '2026-05-01'],
          collectiveVacations: [],
        },
      }),
    );
    const counts = out.summary.map((s) => s.weekendHolidayShifts);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const total = out.shifts.filter((s) => s.dayType === 'weekend' || s.dayType === 'holiday');
    expect(counts.reduce((t, c) => t + c, 0)).toBe(total.length);
  });

  it('atende preferência de dia da semana quando possível', () => {
    const out = generateRotation(
      input([
        member('a', { preferences: { avoidWeekdays: [1], maxConsecutiveShifts: null } }),
        member('b'),
        member('c'),
      ]),
    );
    expect(out.preferenceViolations).toEqual([]);
    for (const s of out.shifts) {
      if (s.userId === 'a') expect([1]).not.toContain(new Date(`${s.date}T00:00:00Z`).getUTCDay());
    }
  });

  it('reporta violação de dia a evitar quando não há alternativa', () => {
    // 2026-03-02 é segunda-feira; b indisponível, só a pode assumir.
    const out = generateRotation(
      input(
        [
          member('a', { preferences: { avoidWeekdays: [1], maxConsecutiveShifts: null } }),
          member('b', { unavailableDates: ['2026-03-02'] }),
        ],
        { to: '2026-03-02' },
      ),
    );
    expect(out.shifts[0]!.userId).toBe('a');
    expect(out.preferenceViolations).toEqual([
      { date: '2026-03-02', userId: 'a', kind: 'avoid_weekday' },
    ]);
  });

  it('respeita máximo de consecutivos e conta lastAssignments', () => {
    const prefs = { avoidWeekdays: [], maxConsecutiveShifts: 2 };
    const members = [member('a', { preferences: prefs }), member('b', { preferences: prefs })];
    const out = generateRotation(input(members, { to: '2026-03-15' }));
    expect(out.preferenceViolations).toEqual([]);
    let run = 0;
    let prev: string | null = null;
    for (const s of out.shifts) {
      run = s.userId === prev ? run + 1 : 1;
      prev = s.userId;
      expect(run).toBeLessThanOrEqual(2);
    }

    const forced = generateRotation(
      input([member('a', { preferences: { avoidWeekdays: [], maxConsecutiveShifts: 2 } })], {
        to: '2026-03-04',
        lastAssignments: [
          { date: '2026-03-01', userId: 'a' },
          { date: '2026-02-28', userId: 'a' },
        ],
      }),
    );
    expect(forced.preferenceViolations.map((v) => v.date)).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
    expect(forced.preferenceViolations.every((v) => v.kind === 'max_consecutive')).toBe(true);
  });

  it('é determinístico e independe da ordem dos membros', () => {
    const members = ['c', 'a', 'd', 'b'].map((id, i) =>
      member(id, { history: { hoursDone: i * 10, weekendHolidayShiftsDone: i } }),
    );
    const first = generateRotation(input(members));
    const second = generateRotation(input(members));
    const shuffled = generateRotation(input([...members].reverse()));
    expect(second).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('membro novo não recebe todos os plantões para compensar', () => {
    const days = dateRange('2026-03-02', '2026-03-31');
    const veteran = { hoursDone: 300, weekendHolidayShiftsDone: 6 };
    const out = generateRotation(
      input([
        member('a', { history: veteran }),
        member('b', { history: veteran }),
        // novo: só disponível nos últimos 10 dias do período, sem histórico
        member('n', { unavailableDates: days.slice(0, 20) }),
      ]),
    );
    const newShifts = out.shifts.filter((s) => s.userId === 'n').length;
    expect(newShifts).toBeGreaterThan(0);
    expect(newShifts).toBeLessThan(10);
    expect(out.shifts.filter((s) => s.userId === 'n').every((s) => s.date >= days[20]!)).toBe(true);
  });

  it('membro voltando de exceção longa não assume o período inteiro', () => {
    const out = generateRotation(
      input([
        member('a', { history: { hoursDone: 150, weekendHolidayShiftsDone: 3 } }),
        member('r', {
          history: { hoursDone: 0, weekendHolidayShiftsDone: 0 },
          unavailableDates: dateRange('2026-03-02', '2026-03-21'),
        }),
        member('c', { history: { hoursDone: 150, weekendHolidayShiftsDone: 3 } }),
      ]),
    );
    const returned = out.shifts.filter((s) => s.userId === 'r').length;
    expect(returned).toBeLessThan(10);
    expect(returned).toBeGreaterThan(0);
  });

  it('3 meses x 20 membros em menos de 1s', () => {
    const members = Array.from({ length: 20 }, (_, i) =>
      member(`m${String(i).padStart(2, '0')}`, {
        preferences: { avoidWeekdays: [i % 7], maxConsecutiveShifts: 3 },
        unavailableDates: [addDays('2026-01-05', i * 3)],
        history: { hoursDone: i * 20, weekendHolidayShiftsDone: i % 4 },
      }),
    );
    const start = performance.now();
    const out = generateRotation(input(members, { from: '2026-01-01', to: '2026-03-31' }));
    const elapsed = performance.now() - start;
    expect(out.shifts).toHaveLength(90);
    expect(elapsed).toBeLessThan(1000);
  });
});
