import { describe, expect, it } from 'vitest';
import {
  renderBalanceAdjustedEmail,
  renderScheduleGeneratedEmail,
  renderTeamMemberEmail,
  renderUserStatusEmail,
} from './event-templates.js';
import { renderEmail } from './templates.js';

const URL_BASE = 'https://plantao.example';

describe('layout dos e-mails', () => {
  it('traz logo do mesmo host do link, nome do produto, selo e tema escuro', () => {
    const out = renderEmail({
      subject: 'Teste',
      badge: { label: 'Aprovada', tone: 'success' },
      paragraphs: ['Olá'],
      action: { label: 'Abrir', url: `${URL_BASE}/swaps` },
    });
    expect(out.html).toContain(`src="${URL_BASE}/icon-192.png"`);
    expect(out.html).toContain('Plantão365');
    expect(out.html).toContain('Aprovada');
    expect(out.html).toContain('prefers-color-scheme: dark');
    expect(out.html).toContain(`href="${URL_BASE}/swaps"`);
  });

  it('sem link de ação não referencia imagem', () => {
    const out = renderEmail({ subject: 'Teste', paragraphs: ['Olá'] });
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('Plantão365');
  });

  it('escapa o selo e a versão texto não leva HTML', () => {
    const out = renderEmail({
      subject: 'x',
      badge: { label: '<b>x</b>', tone: 'info' },
      paragraphs: ['a'],
    });
    expect(out.html).not.toContain('<b>x</b>');
    expect(out.text).not.toContain('<style');
  });
});

describe('templates de eventos novos', () => {
  it('escala gerada: rascunho, equipe e alerta de dias sem responsável', () => {
    const out = renderScheduleGeneratedEmail({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      actorName: 'Gui',
      teamName: 'Infra',
      shifts: 31,
      unassignedDates: 2,
      appUrl: `${URL_BASE}/schedule-admin`,
    });
    expect(out.subject).toBe('Escala em rascunho: 01/12/2026 a 31/12/2026');
    expect(out.text).toContain('Gui gerou a escala');
    expect(out.text).toContain('Equipe: Infra');
    expect(out.text).toContain('Dias sem responsável: 2');
    expect(out.text).toContain('revise a escala antes de publicá-la');
    const clean = renderScheduleGeneratedEmail({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      actorName: 'Gui',
      teamName: 'Infra',
      shifts: 31,
      unassignedDates: 0,
    });
    expect(clean.text).not.toContain('Dias sem responsável');
  });

  it('ajuste de saldo: crédito e débito com motivo escapado', () => {
    const credit = renderBalanceAdjustedEmail({
      date: '2026-03-14',
      hours: 4,
      reason: 'Hora <extra>',
      appUrl: `${URL_BASE}/balance`,
    });
    expect(credit.subject).toBe('Ajuste no seu saldo de horas: +4 h');
    expect(credit.text).toContain('crédito de 4 h');
    expect(credit.text).toContain('Motivo: Hora <extra>');
    expect(credit.html).toContain('Motivo: Hora &lt;extra&gt;');
    const debit = renderBalanceAdjustedEmail({ date: '2026-03-14', hours: -2.5, reason: 'x' });
    expect(debit.subject).toBe('Ajuste no seu saldo de horas: -2,5 h');
    expect(debit.text).toContain('débito de 2,5 h');
  });

  it('equipe: adicionado, atualizado e removido', () => {
    const base = { teamName: 'Infra', role: 'manager' as const, participatesInRotation: false };
    const added = renderTeamMemberEmail({ ...base, kind: 'added', appUrl: URL_BASE });
    expect(added.subject).toBe('Você foi adicionado à equipe Infra');
    expect(added.text).toContain('Perfil: gestor');
    expect(added.text).toContain('não participa do rodízio');
    const updated = renderTeamMemberEmail({ ...base, kind: 'updated' });
    expect(updated.subject).toBe('Seu perfil na equipe Infra foi atualizado');
    const removed = renderTeamMemberEmail({ ...base, kind: 'removed', appUrl: URL_BASE });
    expect(removed.subject).toBe('Você foi removido da equipe Infra');
    expect(removed.text).not.toContain('Perfil:');
    expect(removed.html).not.toContain('<a ');
  });

  it('acesso: reativado leva ao login; desativado não tem link', () => {
    const on = renderUserStatusEmail({ name: 'Ana', active: true, appUrl: URL_BASE });
    expect(on.subject).toBe('Seu acesso ao Plantão365 foi reativado');
    expect(on.html).toContain(`href="${URL_BASE}"`);
    const off = renderUserStatusEmail({ name: 'Ana', active: false, appUrl: URL_BASE });
    expect(off.subject).toBe('Seu acesso ao Plantão365 foi desativado');
    expect(off.html).not.toContain('<a ');
  });
});
