// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth/AuthContext';
import { TeamSchedulePage } from '../pages/TeamSchedulePage';
import type { ShiftDto } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = {
  id: 'u1',
  email: 'a@b.c',
  name: 'Ana Souza',
  role: 'member',
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
};

const shift = (
  date: string,
  userId: string,
  userName: string,
  dayType: ShiftDto['dayType'] = 'weekday',
  hours = 14,
): ShiftDto => ({
  id: `${date}-${userId}`,
  scheduleId: 's1',
  date,
  dayType,
  hours,
  startsAt: null,
  endsAt: null,
  userId,
  userName,
  originalUserId: null,
  originalHours: null,
});

interface Data {
  shifts?: ShiftDto[];
  holidays?: unknown[];
  vacations?: unknown[];
}

function mockApi(data: Data = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/auth/me') return Promise.resolve(json(me));
    if (url === '/api/shift-settings') {
      return Promise.resolve(
        json({
          weekday: { startHour: 19, endHour: 7 },
          weekend: { startHour: 8, endHour: 8 },
          holiday: { startHour: 8, endHour: 8 },
        }),
      );
    }
    if (url.startsWith('/api/shifts')) return Promise.resolve(json(data.shifts ?? []));
    if (url.startsWith('/api/holidays'))
      return Promise.resolve(json({ items: data.holidays ?? [] }));
    if (url.startsWith('/api/unavailabilities')) {
      return Promise.resolve(json({ items: data.vacations ?? [] }));
    }
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const rangesOf = (fetchMock: ReturnType<typeof vi.fn>, prefix: string) =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith(prefix))
    .map((u) => {
      const p = new URL(u, 'http://localhost').searchParams;
      return `${p.get('from')}..${p.get('to')}`;
    });

function renderPage(today: string) {
  return render(
    <AuthProvider>
      <TeamSchedulePage today={today} />
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TeamSchedulePage', () => {
  it('monta fevereiro bissexto de 2028 e carrega as três consultas do mês', async () => {
    const fetchMock = mockApi();
    renderPage('2028-02-15');
    const grid = await screen.findByRole('list', { name: 'Escala de fevereiro de 2028' });
    await waitFor(() => expect(within(grid).getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(screen.getByText('fevereiro de 2028')).toBeTruthy();
    expect(screen.getByTestId('day-2028-02-29')).toBeTruthy();
    expect(screen.queryByTestId('day-2028-03-01')).toBeNull();
    expect(rangesOf(fetchMock, '/api/shifts')).toEqual(['2028-02-01..2028-02-29']);
    expect(rangesOf(fetchMock, '/api/holidays')).toEqual(['2028-02-01..2028-02-29']);
    expect(rangesOf(fetchMock, '/api/unavailabilities')).toEqual(['2028-02-01..2028-02-29']);
  });

  it('mostra responsável, horas, feriado e férias coletivas e destaca o próprio plantão', async () => {
    mockApi({
      shifts: [
        shift('2026-03-02', 'u1', 'Ana Souza'),
        shift('2026-03-03', 'u2', 'Bruno Lima'),
        shift('2026-03-07', 'u2', 'Bruno Lima', 'weekend', 24),
      ],
      holidays: [{ id: 'h', date: '2026-03-03', name: 'Dia Teste', scope: 'national' }],
      vacations: [
        {
          id: 'v',
          userId: null,
          kind: 'collective_vacation',
          startDate: '2026-03-25',
          endDate: '2026-03-26',
        },
        { id: 'w', userId: 'u2', kind: 'vacation', startDate: '2026-03-10', endDate: '2026-03-12' },
      ],
    });
    renderPage('2026-03-10');

    const mine = await screen.findByTestId('day-2026-03-02');
    expect(mine.className).toContain('sched-day--mine');
    expect(within(mine).getByText(/Ana Souza/)).toBeTruthy();
    expect(within(mine).getByText('14h')).toBeTruthy();

    const other = screen.getByTestId('day-2026-03-03');
    expect(other.className).not.toContain('sched-day--mine');
    expect(within(other).getByText('Bruno Lima')).toBeTruthy();
    expect(within(other).getByText('Feriado: Dia Teste')).toBeTruthy();
    expect(within(screen.getByTestId('day-2026-03-07')).getByText('24h')).toBeTruthy();
    expect(within(mine).getByText('Dia útil')).toBeTruthy();
    expect(within(screen.getByTestId('day-2026-03-07')).getByText('Fim de semana')).toBeTruthy();
    expect(screen.queryByTestId('day-type-2026-03-03')).toBeNull();

    expect(within(screen.getByTestId('day-2026-03-25')).getByText('Férias coletivas')).toBeTruthy();
    expect(within(screen.getByTestId('day-2026-03-10')).queryByText('Férias coletivas')).toBeNull();
    expect(screen.getByTestId('day-2026-03-05').className).toContain('sched-day--empty');

    expect(other.className).toContain('sched-day--holiday');
    expect(screen.getByTestId('day-2026-03-07').className).toContain('sched-day--weekend');
    expect(screen.getByTestId('day-2026-03-08').className).toContain('sched-day--weekend');
    expect(mine.className).not.toMatch(/sched-day--(weekend|holiday)/);
  });

  it('filtra por membro presente no mês', async () => {
    mockApi({
      shifts: [shift('2026-03-02', 'u1', 'Ana Souza'), shift('2026-03-03', 'u2', 'Bruno Lima')],
    });
    renderPage('2026-03-10');
    await screen.findByTestId('day-2026-03-02');
    const select = screen.getByRole('combobox', { name: 'Membro' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Todos', 'Ana Souza', 'Bruno Lima']);
    await userEvent.selectOptions(select, 'u2');
    expect(within(screen.getByTestId('day-2026-03-02')).queryByText(/Ana Souza/)).toBeNull();
    expect(within(screen.getByTestId('day-2026-03-03')).getByText('Bruno Lima')).toBeTruthy();
  });

  it('navega entre meses, inclusive virada de ano, consultando o intervalo certo', async () => {
    const fetchMock = mockApi();
    renderPage('2026-12-15');
    await screen.findByText('dezembro de 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    await screen.findByText('janeiro de 2027');
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    await screen.findByText('novembro de 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    await screen.findByText('dezembro de 2026');
    const ranges = rangesOf(fetchMock, '/api/shifts');
    expect(ranges).toContain('2027-01-01..2027-01-31');
    expect(ranges).toContain('2026-11-01..2026-11-30');
    expect(ranges[0]).toBe('2026-12-01..2026-12-31');
  });

  it('mostra foto, horário do plantão e legenda com o horário configurado', async () => {
    mockApi({
      shifts: [
        {
          ...shift('2026-03-02', 'u2', 'Bruno Lima', 'weekday', 12),
          startsAt: '2026-03-02T22:00:00.000Z',
          endsAt: '2026-03-03T10:00:00.000Z',
        },
      ],
    });
    renderPage('2026-03-10');
    const day = await screen.findByTestId('day-2026-03-02');
    expect(within(day).getByText('19h–07h')).toBeTruthy();
    expect(within(day).getByTitle('Termina no dia seguinte')).toBeTruthy();
    expect(within(day).getByText('12h')).toBeTruthy();
    expect(day.querySelector('img')?.getAttribute('src')).toBe('/api/users/u2/photo');
    const legend = screen.getByRole('list', { name: 'Legenda' });
    await waitFor(() => expect(legend.textContent).toContain('Dia útil: 19h–07h (12h)'));
    expect(legend.textContent).toContain('Feriado: 08h–08h (24h)');
  });

  it('exibe erro de carregamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url === '/auth/me' ? json(me) : json({ message: 'falhou' }, 500)),
      ),
    );
    renderPage('2026-03-10');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('falhou'));
  });
});
