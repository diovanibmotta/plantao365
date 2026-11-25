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
  colleagues?: unknown[];
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
    if (url === '/api/users/colleagues') return Promise.resolve(json(data.colleagues ?? []));
    if (url === '/api/users/u2/contact') {
      return Promise.resolve(
        json({ id: 'u2', name: 'Jorge Kohn', email: 'jorge@x.com', phone: '(47) 99999-0000' }),
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
  it('abre o cartão de visita ao clicar no responsável do dia e fecha', async () => {
    mockApi({ shifts: [shift('2028-02-10', 'u2', 'Jorge Kohn')] });
    renderPage('2028-02-15');
    const day = await screen.findByTestId('day-2028-02-10');
    await userEvent.click(within(day).getByRole('button', { name: /Jorge Kohn/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Jorge Kohn' });
    expect(await within(dialog).findByText('jorge@x.com')).toBeTruthy();
    expect(within(dialog).getByText('(47) 99999-0000')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

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
    ).toEqual(['Todos', 'Eu', 'Bruno Lima']);
    await userEvent.selectOptions(select, 'u2');
    expect(within(screen.getByTestId('day-2026-03-02')).queryByText(/Ana Souza/)).toBeNull();
    expect(within(screen.getByTestId('day-2026-03-03')).getByText('Bruno Lima')).toBeTruthy();
  });

  it('filtra "Eu": esmaece dias sem plantão do usuário logado', async () => {
    mockApi({
      shifts: [shift('2026-03-02', 'u1', 'Ana Souza'), shift('2026-03-03', 'u2', 'Bruno Lima')],
      holidays: [{ id: 'h', date: '2026-03-03', name: 'Dia Teste', scope: 'national' }],
    });
    renderPage('2026-03-10');
    await screen.findByTestId('day-2026-03-02');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Membro' }), '@me');

    const mine = screen.getByTestId('day-2026-03-02');
    expect(within(mine).getByText(/Ana Souza/)).toBeTruthy();
    expect(mine.className).not.toContain('sched-day--dimmed');
    const other = screen.getByTestId('day-2026-03-03');
    expect(other.className).toContain('sched-day--dimmed');
    expect(within(other).queryByText('Bruno Lima')).toBeNull();
    expect(within(other).queryByText(/Feriado/)).toBeNull();
    expect(screen.getByTestId('day-2026-03-05').className).toContain('sched-day--dimmed');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Membro' }), '');
    expect(within(screen.getByTestId('day-2026-03-03')).getByText(/Bruno Lima/)).toBeTruthy();
  });

  it('lista os membros da equipe no filtro, mesmo sem plantão no período', async () => {
    mockApi({
      shifts: [shift('2026-03-02', 'u1', 'Ana Souza')],
      colleagues: [{ id: 'u3', name: 'Carla Dias' }],
    });
    renderPage('2026-03-10');
    await screen.findByTestId('day-2026-03-02');
    const select = await screen.findByRole('combobox', { name: 'Membro' });
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Carla Dias' })).toBeTruthy(),
    );
    expect(within(select).getByRole('option', { name: 'Eu' })).toBeTruthy();
    expect(within(select).queryByRole('option', { name: 'Ana Souza' })).toBeNull();
  });

  it('filtra por status: realizado (já terminou) e pendente (ainda não)', async () => {
    mockApi({
      shifts: [shift('2026-03-02', 'u1', 'Ana Souza'), shift('2026-03-20', 'u2', 'Bruno Lima')],
    });
    renderPage('2026-03-10');
    await screen.findByTestId('day-2026-03-02');
    const status = await screen.findByRole('combobox', { name: 'Status' });

    await userEvent.selectOptions(status, 'done');
    expect(within(screen.getByTestId('day-2026-03-02')).getByText('Realizado')).toBeTruthy();
    expect(screen.getByTestId('day-2026-03-20').className).toContain('sched-day--dimmed');

    await userEvent.selectOptions(status, 'pending');
    expect(within(screen.getByTestId('day-2026-03-20')).getByText('Pendente')).toBeTruthy();
    expect(screen.getByTestId('day-2026-03-02').className).toContain('sched-day--dimmed');
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
    expect(within(day).getByText('19:00–07:00')).toBeTruthy();
    expect(within(day).getByTitle('Termina no dia seguinte')).toBeTruthy();
    expect(within(day).getByText('12h')).toBeTruthy();
    expect(day.querySelector('img')?.getAttribute('src')).toBe('/api/users/u2/photo');
    const legend = screen.getByRole('list', { name: 'Legenda' });
    await waitFor(() => expect(legend.textContent).toContain('Dia útil: 19:00–07:00 (12h)'));
    expect(legend.textContent).toContain('Feriado: 08:00–08:00 (24h)');
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
