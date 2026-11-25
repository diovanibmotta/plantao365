import { describe, expect, it } from 'vitest';
import { impactConfirmMessage, impactMessage, mergeScheduleImpacts } from './message.js';
import type { ScheduleImpact } from './types.js';

describe('aviso de impacto em escala publicada', () => {
  it('mensagem pt-BR por origem, singular/plural e menção ao e-mail do gestor', () => {
    expect(impactMessage('holiday', 1)).toContain('1 plantão publicado');
    expect(impactMessage('collective_vacation', 3)).toContain('3 plantões publicados');
    for (const s of [
      'member_exception',
      'collective_vacation',
      'holiday',
      'shift_times',
      'shift_exception',
    ] as const) {
      const m = impactMessage(s, 2);
      expect(m).toContain('Recalcule ou ajuste a escala');
      expect(m).toContain('avisados por e-mail');
    }
  });

  it('confirmação prévia usa futuro; exclusão tem texto próprio', () => {
    const before = impactConfirmMessage('collective_vacation', 2);
    expect(before).toContain('2 plantões publicados');
    expect(before).toContain('serão avisados por e-mail');
    expect(before).not.toContain('foram avisados');
    expect(impactConfirmMessage('member_exception', 1, true)).toContain('no período desta exceção');
    expect(impactMessage('shift_exception', 1, true)).toContain('depois da exclusão');
  });

  it('une avisos: soma plantões, une datas e agrupa por equipe', () => {
    const a: ScheduleImpact = {
      source: 'member_exception',
      removed: false,
      shifts: 2,
      dates: ['2026-12-02', '2026-12-03'],
      teams: [{ teamId: 'a', dates: ['2026-12-02', '2026-12-03'], shifts: 2 }],
      message: '',
    };
    const b: ScheduleImpact = {
      ...a,
      shifts: 1,
      dates: ['2026-12-03'],
      teams: [{ teamId: 'a', dates: ['2026-12-03'], shifts: 1 }],
    };
    const merged = mergeScheduleImpacts([a, b])!;
    expect(merged.shifts).toBe(3);
    expect(merged.dates).toEqual(['2026-12-02', '2026-12-03']);
    expect(merged.teams).toEqual([{ teamId: 'a', dates: ['2026-12-02', '2026-12-03'], shifts: 3 }]);
    expect(merged.message).toContain('3 plantões publicados');
    expect(mergeScheduleImpacts([])).toBeNull();
  });
});
