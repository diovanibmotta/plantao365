import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateRange,
  formatHours,
  formatShift,
  formatShiftPeriod,
  localIsoDate,
} from './format.js';
import { escapeHtml, renderEmail, renderLayout } from './templates.js';

const dayShift = {
  date: '2026-03-14',
  startsAt: new Date('2026-03-14T11:00:00Z'),
  endsAt: new Date('2026-03-14T23:00:00Z'),
  hours: 12,
};
const nightShift = {
  date: '2026-03-14',
  startsAt: new Date('2026-03-14T23:00:00Z'),
  endsAt: new Date('2026-03-15T11:00:00Z'),
  hours: 12,
};

describe('formatação pt-BR', () => {
  it('formata datas, horas e períodos', () => {
    expect(formatDate('2026-03-14')).toBe('sábado, 14 de março de 2026');
    expect(formatHours(12)).toBe('12 h');
    expect(formatHours(7.5)).toBe('7,5 h');
    expect(formatDateRange('2026-03-01', '2026-03-31')).toBe('01/03/2026 a 31/03/2026');
    expect(formatDateRange('2026-03-01', '2026-03-01')).toBe('01/03/2026');
  });

  it('usa o fuso America/Sao_Paulo', () => {
    expect(formatShiftPeriod(dayShift.startsAt, dayShift.endsAt)).toBe('das 08:00 às 20:00');
    expect(localIsoDate(new Date('2026-03-15T02:30:00Z'))).toBe('2026-03-14');
  });

  it('indica turno que cruza a meia-noite', () => {
    expect(formatShiftPeriod(nightShift.startsAt, nightShift.endsAt)).toBe(
      'das 20:00 às 08:00 (dia seguinte)',
    );
    expect(formatShift(nightShift)).toBe(
      'sábado, 14 de março de 2026, das 20:00 às 08:00 (dia seguinte), 12 h',
    );
  });

  it('rejeita data inválida', () => {
    expect(() => formatDate('14/03/2026')).toThrow(/inválida/);
  });
});

describe('templates', () => {
  it('escapa HTML', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('renderLayout produz HTML em pt-BR e versão texto', () => {
    const { html, text } = renderLayout({
      title: 'Olá',
      bodyHtml: '<p>corpo</p>',
      bodyText: 'corpo',
    });
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('<p>corpo</p>');
    expect(text).toBe(
      'Olá\n\ncorpo\n\n--\nPlantão360 · mensagem automática, não responda este e-mail.\n',
    );
  });

  it('renderEmail inclui data, período e horas do plantão em HTML e texto', () => {
    const out = renderEmail({
      subject: 'Escala publicada',
      paragraphs: ['Sua escala de março foi publicada.'],
      shifts: [dayShift, nightShift],
      action: { label: 'Abrir minha escala', url: 'https://plantao.example/minha-escala' },
    });
    expect(out.subject).toBe('Escala publicada');
    for (const body of [out.html, out.text]) {
      expect(body).toContain('sábado, 14 de março de 2026');
      expect(body).toContain('das 08:00 às 20:00');
      expect(body).toContain('12 h');
    }
    expect(out.text).toContain('- sábado, 14 de março de 2026, das 08:00 às 20:00, 12 h');
    expect(out.html).toContain('href="https://plantao.example/minha-escala"');
  });

  it('escapa conteúdo dinâmico nos parágrafos', () => {
    const out = renderEmail({ subject: 'x', paragraphs: ['<script>alert(1)</script>'] });
    expect(out.html).not.toContain('<script>');
    expect(out.text).toContain('<script>alert(1)</script>');
  });
});
