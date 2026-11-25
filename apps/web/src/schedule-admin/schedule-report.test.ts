import { describe, expect, it } from 'vitest';
import type { ShiftDto } from '../schedule/types';
import { buildSchedulePdf } from './schedule-pdf';
import { buildCsv, coverage, memberTotals, reportContext, reportFileName } from './schedule-report';
import type { ScheduleDetail } from './types';

const shift = (date: string, over: Partial<ShiftDto> = {}): ShiftDto => ({
  id: `sh-${date}`,
  scheduleId: 's1',
  date,
  dayType: 'weekday',
  hours: 14,
  startsAt: null,
  endsAt: null,
  userId: 'u1',
  userName: 'Ana Souza',
  userBadgeNumber: '10231',
  originalUserId: null,
  originalHours: null,
  ...over,
});

const schedule: ScheduleDetail = {
  id: 's1',
  startDate: '2026-12-24',
  endDate: '2026-12-28',
  status: 'published',
  publishedAt: '2026-12-10T19:05:00Z',
  createdBy: 'm1',
  shifts: [
    shift('2026-12-24'),
    shift('2026-12-25', {
      dayType: 'holiday',
      hours: 24,
      userId: 'u2',
      userName: 'Bruno; "B"',
      userBadgeNumber: null,
    }),
    shift('2026-12-26', { dayType: 'weekend', hours: 24 }),
    shift('2026-12-27', { dayType: 'collective_vacation', hours: 0, userId: null, userName: null }),
    shift('2026-12-28', { userId: null, userName: null, userBadgeNumber: null }),
  ],
};

const ctx = { teamName: 'Infraestrutura Ágil', managerName: 'Marina Alves' };

describe('relatório da escala', () => {
  it('totaliza por membro ignorando férias coletivas e dias sem responsável', () => {
    expect(memberTotals(schedule.shifts)).toEqual([
      { name: 'Ana Souza', badge: '10231', shifts: 2, weekendHolidayShifts: 1, hours: 38 },
      { name: 'Bruno; "B"', badge: null, shifts: 1, weekendHolidayShifts: 1, hours: 24 },
    ]);
    expect(coverage(schedule.shifts)).toEqual({ covered: 3, total: 4 });
  });

  it('gestor é quem gerou a escala; sem o nome, usa os gestores da equipe', () => {
    const team = { id: 't1', name: 'Infra', managers: ['Carla', 'Diego'] };
    expect(reportContext(schedule, new Map([['m1', 'Marina']]), team)).toEqual({
      teamName: 'Infra',
      managerName: 'Marina',
    });
    expect(reportContext(schedule, new Map(), team).managerName).toBe('Carla, Diego');
    expect(reportContext(schedule, new Map(), null)).toEqual({ teamName: '', managerName: '' });
  });

  it('CSV respeita campos e ordem, escapa ; e aspas e começa com BOM', () => {
    const csv = buildCsv(schedule, ['member', 'date', 'hours', 'team'], ctx);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Responsável;Data;Horas;Equipe',
      'Ana Souza;24/12/2026;14;Infraestrutura Ágil',
      '"Bruno; ""B""";25/12/2026;24;Infraestrutura Ágil',
      'Ana Souza;26/12/2026;24;Infraestrutura Ágil',
      'Férias coletivas;27/12/2026;;Infraestrutura Ágil',
      'Sem responsável;28/12/2026;14;Infraestrutura Ágil',
      '',
    ]);
  });

  it('CSV traz horário separado em início e fim', () => {
    const lines = buildCsv(schedule, ['start', 'end', 'dayType', 'status'], ctx).split('\r\n');
    expect(lines[1]).toBe('18:00;08:00;Dia útil;Publicada');
    expect(lines[2]).toBe('08:00;08:00;Feriado;Publicada');
    expect(lines[4]).toBe(';;Férias coletivas;Publicada');
  });

  it('nome do arquivo leva equipe sem acento e o período', () => {
    expect(reportFileName(schedule, ctx, 'pdf')).toBe(
      'escala-infraestrutura-agil-2026-12-24_2026-12-28.pdf',
    );
    expect(reportFileName(schedule, { teamName: '', managerName: '' }, 'csv')).toBe(
      'escala-2026-12-24_2026-12-28.csv',
    );
  });

  it('PDF traz cabeçalho, plantões e totalização', async () => {
    const doc = await buildSchedulePdf(schedule, ctx, new Date('2026-12-11T12:00:00Z'));
    const text = doc.output();
    expect(doc.getNumberOfPages()).toBe(1);
    for (const piece of [
      'Marina Alves',
      '24/12/2026 a 28/12/2026',
      '3/4 dias',
      'Ana Souza',
      '38h',
    ]) {
      expect(text).toContain(piece);
    }
    // Matrícula vem antes do nome, nos plantões e na totalização.
    expect(text).toContain('Matr');
    expect(text.indexOf('(10231)')).toBeLessThan(text.indexOf('(Ana Souza)'));
    expect(text.lastIndexOf('(10231)')).toBeLessThan(text.lastIndexOf('(Ana Souza)'));
  });

  it('PDF omite a coluna de matrícula quando ninguém tem', async () => {
    const noBadges = {
      ...schedule,
      shifts: schedule.shifts.map((s) => ({ ...s, userBadgeNumber: null })),
    };
    const text = (await buildSchedulePdf(noBadges, ctx)).output();
    expect(text).not.toContain('Matr');
    expect(text).toContain('(Ana Souza)');
  });
});
