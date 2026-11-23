// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MySchedulePage } from '../pages/MySchedulePage';
import type { ShiftDto } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const shift = (date: string, dayType: ShiftDto['dayType'], hours: number): ShiftDto => ({
  id: date,
  scheduleId: 's1',
  date,
  dayType,
  hours,
  startsAt: null,
  endsAt: null,
  userId: 'u1',
  userName: 'Ana Souza',
  originalUserId: null,
  originalHours: null,
});

const TODAY = '2026-03-10';

function mockApi(shifts: ShiftDto[], holidays: unknown[] = []) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url.startsWith('/api/shifts/mine')
        ? json(shifts)
        : url.startsWith('/api/holidays')
          ? json({ items: holidays })
          : json({}, 404),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MySchedulePage', () => {
  it('separa próximos (crescente) e anteriores (decrescente) com tipo e horas', async () => {
    mockApi(
      [
        shift('2026-03-20', 'weekday', 14),
        shift('2026-03-14', 'weekend', 24),
        shift('2026-03-10', 'weekday', 14),
        shift('2026-03-01', 'weekend', 24),
        shift('2026-02-20', 'weekday', 14),
        shift('2026-03-12', 'holiday', 24),
      ],
      [{ id: 'h', date: '2026-03-12', name: 'Dia Teste', scope: 'national' }],
    );
    render(<MySchedulePage today={TODAY} />);

    const items = await screen.findAllByTestId('shift-item');
    expect(items.map((i) => within(i).getByText(/\d{4}$/).textContent)).toEqual([
      'ter, 10 mar 2026',
      'qui, 12 mar 2026',
      'sáb, 14 mar 2026',
      'sex, 20 mar 2026',
    ]);
    expect(within(items[0]!).getByText('Dia útil')).toBeTruthy();
    expect(within(items[0]!).getByText('18h–08h')).toBeTruthy();
    expect(within(items[0]!).getByText('14h')).toBeTruthy();
    expect(within(items[1]!).getByText('Feriado: Dia Teste')).toBeTruthy();
    expect(within(items[2]!).getByText('Fim de semana')).toBeTruthy();
    expect(within(items[2]!).getByText('08h–08h')).toBeTruthy();
    expect(within(items[2]!).getByText('24h')).toBeTruthy();
    expect(screen.getByText('76h')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: /Anteriores/ }));
    const past = screen.getAllByTestId('shift-item');
    expect(past.map((i) => within(i).getByText(/\d{4}$/).textContent)).toEqual([
      'dom, 01 mar 2026',
      'sex, 20 fev 2026',
    ]);
  });

  it('mostra estado vazio', async () => {
    const fetchMock = mockApi([]);
    render(<MySchedulePage today={TODAY} />);
    expect(await screen.findByText(/não tem plantões publicados/)).toBeTruthy();
    expect(screen.getByText('0h')).toBeTruthy();
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.searchParams.get('from')).toBe('2025-11-10');
    expect(url.searchParams.get('to')).toBe('2026-11-05');
  });

  it('exibe erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ message: 'falhou' }, 500))),
    );
    render(<MySchedulePage today={TODAY} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('falhou'));
  });

  it('permite acrescentar ações por item', async () => {
    mockApi([shift('2026-03-20', 'weekday', 14)]);
    render(<MySchedulePage today={TODAY} renderActions={() => <button>Solicitar troca</button>} />);
    expect(await screen.findByRole('button', { name: 'Solicitar troca' })).toBeTruthy();
  });
});
