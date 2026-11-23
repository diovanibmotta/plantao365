// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/AuthContext';
import { BalancePage } from '../pages/BalancePage';
import { formatHours, formatSignedHours, parseHours } from './format';
import type { Adjustment, MemberBalance } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = (role: AuthUser['role']): AuthUser => ({
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  role,
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
});

const months = Array.from({ length: 12 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, '0')}`,
  planned: i === 0 ? 14 : 0,
  actual: i === 0 ? 14 : 0,
  difference: i === 0 ? 0 : 0,
}));

const balance: MemberBalance = {
  year: 2026,
  userId: 'u1',
  months: months.map((m) =>
    m.month === '2026-02'
      ? { ...m, planned: 24, actual: 22.5, difference: -1.5 }
      : m.month === '2026-03'
        ? { ...m, planned: 0, actual: 1234.5, difference: 1234.5 }
        : m,
  ),
  total: { planned: 38, actual: 1271, difference: 1233 },
  shifts: [
    {
      date: '2026-02-07',
      dayType: 'weekend',
      plannedHours: 24,
      actualHours: 22.5,
      status: 'done',
      swapped: true,
    },
    {
      date: '2026-12-10',
      dayType: 'weekday',
      plannedHours: 14,
      actualHours: 14,
      status: 'upcoming',
      swapped: false,
    },
  ],
};

const adjustment: Adjustment = {
  id: 'a1',
  userId: 'u2',
  date: '2026-02-10',
  hours: -2,
  reason: 'Atraso',
  createdBy: 'u1',
  createdAt: '2026-02-10T10:00:00.000Z',
};

const team = {
  year: 2026,
  members: [
    { userId: 'u1', name: 'Ana', planned: 38, actual: 40, difference: 2, months },
    { userId: 'u2', name: 'Bia', planned: 38, actual: 30, difference: -8, months },
  ],
};

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

function mockApi(role: AuthUser['role'], handler: Handler = () => undefined) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const custom = handler(url, init);
    if (custom) return Promise.resolve(custom);
    if (url === '/auth/me') return Promise.resolve(json(me(role)));
    if (url.startsWith('/api/me/balance')) return Promise.resolve(json(balance));
    if (url.startsWith('/api/users/u2/balance')) {
      return Promise.resolve(json({ ...balance, userId: 'u2' }));
    }
    if (url.startsWith('/api/balance/adjustments') && (init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(json({ items: [adjustment] }));
    }
    if (url.startsWith('/api/balance?')) return Promise.resolve(json(team));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderPage = () =>
  render(
    <AuthProvider>
      <BalancePage currentYear={2026} />
    </AuthProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('formatação', () => {
  it('formata horas em pt-BR com sinal', () => {
    expect(formatHours(1234.5)).toBe('1.234,5h');
    expect(formatSignedHours(2.5)).toBe('+2,5h');
    expect(formatSignedHours(-1)).toBe('-1h');
    expect(formatSignedHours(0)).toBe('0h');
    expect(parseHours('-2,5')).toBe(-2.5);
    expect(parseHours('abc')).toBeNull();
  });
});

describe('saldo do membro', () => {
  it('mostra tabela mensal, total do ano e detalhe por plantão', async () => {
    mockApi('member');
    renderPage();

    const monthly = await screen.findByRole('table', { name: /Saldo mensal/ });
    const feb = within(monthly).getByRole('row', { name: /fev\/2026/ });
    expect(within(feb).getByText('24h')).toBeTruthy();
    expect(within(feb).getByText('22,5h')).toBeTruthy();
    const diff = within(feb).getByText('-1,5h');
    expect(diff.className).toContain('bal-neg');
    const total = within(monthly).getByRole('row', { name: /Total do ano/ });
    expect(within(total).getByText('+1.233h').className).toContain('bal-pos');

    const rows = screen.getAllByTestId('bal-shift');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Fim de semana')).toBeTruthy();
    expect(within(rows[0]!).getByText('Concluído')).toBeTruthy();
    expect(within(rows[0]!).getByText('Troca')).toBeTruthy();
    expect(within(rows[1]!).getByText('Futuro')).toBeTruthy();
    expect(within(rows[1]!).queryByText('Troca')).toBeNull();
  });

  it('troca o ano e não exibe visões de gestor', async () => {
    const fetchMock = mockApi('member');
    renderPage();
    await screen.findByRole('table', { name: /Saldo mensal/ });
    expect(screen.queryByRole('tab')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Ano'), '2025');
    await screen.findByRole('table', { name: /Saldo mensal/ });
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/me/balance?year=2025');
  });

  it('mostra erro da API', async () => {
    mockApi('member', (url) =>
      url.startsWith('/api/me/balance') ? json({ message: 'Falhou' }, 500) : undefined,
    );
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('Falhou');
  });
});

describe('saldo do gestor', () => {
  it('comparativo abre o detalhe do membro', async () => {
    const fetchMock = mockApi('manager');
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Equipe' }));
    const table = await screen.findByRole('table', { name: /Comparativo/ });
    expect(within(table).getByText('-8h').className).toContain('bal-neg');
    await userEvent.click(within(table).getByRole('button', { name: 'Bia' }));
    expect(await screen.findByRole('region', { name: 'Saldo de Bia' })).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/api/users/u2/balance?year=2026');
  });

  it('cria ajuste exigindo motivo e remove com confirmação', async () => {
    const fetchMock = mockApi('manager', (url, init) =>
      url === '/api/balance/adjustments' && init?.method === 'POST'
        ? json({ adjustment }, 201)
        : url.startsWith('/api/balance/adjustments/') && init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : undefined,
    );
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Ajustes' }));
    expect(await screen.findAllByTestId('bal-adjustment')).toHaveLength(1);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Membro' }), 'u2');
    await user.type(screen.getByLabelText('Data'), '2026-03-05');
    await user.type(screen.getByLabelText(/Horas/), '-2,5');
    await user.click(screen.getByRole('button', { name: 'Adicionar ajuste' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Informe o motivo.');

    await user.type(screen.getByLabelText('Motivo'), 'Saída antecipada');
    await user.click(screen.getByRole('button', { name: 'Adicionar ajuste' }));
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        userId: 'u2',
        date: '2026-03-05',
        hours: -2.5,
        reason: 'Saída antecipada',
      });
    });

    await user.click(await screen.findByRole('button', { name: /Remover ajuste de Bia/ }));
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true);
    });
  });
});
