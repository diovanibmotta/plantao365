// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConflictBadge, conflictSummary } from './ConflictBadge';

afterEach(cleanup);

describe('coluna de conflitos da escala', () => {
  it('sem conflito: V verde', () => {
    render(<ConflictBadge conflicts={{ unavailable: 0, outdated: 0 }} />);
    expect(screen.getByLabelText('Sem conflitos').textContent).toBe('✓');
  });

  it('com conflito: alerta com o motivo', () => {
    render(<ConflictBadge conflicts={{ unavailable: 2, outdated: 1 }} />);
    const alert = screen.getByRole('img');
    expect(alert.textContent).toContain('Conflito');
    expect(alert.getAttribute('aria-label')).toContain('2 plantões em dia de férias ou exceção');
    expect(alert.getAttribute('aria-label')).toContain('1 plantão diferente de feriados');
  });

  it('sem dados (membro ou API antiga): traço', () => {
    render(<ConflictBadge conflicts={undefined} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(conflictSummary({ unavailable: 0, outdated: 0 })).toBe('');
  });
});
