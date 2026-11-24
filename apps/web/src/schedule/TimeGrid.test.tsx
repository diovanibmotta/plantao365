// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth/AuthContext';
import { TeamSchedulePage } from '../pages/TeamSchedulePage';
import { segmentOnDate, shiftAnchor, viewDates, viewLabel, viewRange } from './calendar';
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

// Terça 24/11/2026, 18h–08h (America/Sao_Paulo, UTC-3).
const overnight: ShiftDto = {
  id: 'sh1',
  scheduleId: 's1',
  date: '2026-11-24',
  dayType: 'weekday',
  hours: 14,
  startsAt: '2026-11-24T21:00:00.000Z',
  endsAt: '2026-11-25T11:00:00.000Z',
  userId: 'u1',
  userName: 'Ana Souza',
  originalUserId: null,
  originalHours: null,
};

function mockApi() {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/auth/me') return Promise.resolve(json(me));
    if (url === '/api/shift-settings') {
      return Promise.resolve(
        json({
          weekday: { startHour: 18, endHour: 8 },
          weekend: { startHour: 8, endHour: 8 },
          holiday: { startHour: 8, endHour: 8 },
        }),
      );
    }
    if (url === '/api/work-hours') {
      return Promise.resolve(
        json({
          periods: [
            { startMinute: 480, endMinute: 720 },
            { startMinute: 810, endMinute: 1080 },
          ],
        }),
      );
    }
    if (url.startsWith('/api/shifts')) return Promise.resolve(json([overnight]));
    if (url.startsWith('/api/holidays')) return Promise.resolve(json({ items: [] }));
    if (url.startsWith('/api/unavailabilities')) return Promise.resolve(json({ items: [] }));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('helpers de visão', () => {
  it('semana vai de domingo a sábado e busca também o dia anterior', () => {
    expect(viewDates('week', '2026-11-24')[0]).toBe('2026-11-22');
    expect(viewDates('week', '2026-11-24')[6]).toBe('2026-11-28');
    expect(viewRange('week', '2026-11-24')).toEqual({ from: '2026-11-21', to: '2026-11-28' });
    expect(viewRange('day', '2026-11-24')).toEqual({ from: '2026-11-23', to: '2026-11-24' });
  });

  it('rótulos e navegação', () => {
    expect(viewLabel('week', '2026-11-24')).toBe('22–28 de novembro de 2026');
    expect(viewLabel('week', '2026-11-30')).toBe('29 de novembro – 5 de dezembro de 2026');
    expect(viewLabel('day', '2026-11-24')).toBe('terça-feira, 24 de novembro de 2026');
    expect(shiftAnchor('week', '2026-11-24', 1)).toBe('2026-12-01');
    expect(shiftAnchor('day', '2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
  });

  it('divide plantão que vira a meia-noite entre os dois dias', () => {
    const start = { date: '2026-11-24', minute: 1080 };
    const end = { date: '2026-11-25', minute: 480 };
    expect(segmentOnDate('2026-11-24', start, end)).toEqual({ startMinute: 1080, endMinute: 1440 });
    expect(segmentOnDate('2026-11-25', start, end)).toEqual({ startMinute: 0, endMinute: 480 });
    expect(segmentOnDate('2026-11-26', start, end)).toBeNull();
    // 08h–08h do dia seguinte não gera trecho vazio no último dia.
    expect(
      segmentOnDate(
        '2026-11-26',
        { date: '2026-11-25', minute: 480 },
        { date: '2026-11-26', minute: 0 },
      ),
    ).toBeNull();
  });
});

describe('TeamSchedulePage — visões de semana e dia', () => {
  it('semana: plantão noturno aparece nos dois dias e a jornada só em dias úteis', async () => {
    const fetchMock = mockApi();
    render(
      <AuthProvider>
        <TeamSchedulePage today="2026-11-24" />
      </AuthProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Semana' }));

    const tue = await screen.findByTestId('col-2026-11-24');
    const wed = screen.getByTestId('col-2026-11-25');
    expect(within(tue).getByText('18:00–24:00')).toBeTruthy();
    expect(within(wed).getByText('00:00–08:00')).toBeTruthy();
    expect(within(wed).getByText(/continuação do dia anterior/)).toBeTruthy();
    expect(within(tue).getByText(/continua no dia seguinte/)).toBeTruthy();
    expect(within(tue).getAllByTestId('work-2026-11-24')).toHaveLength(2);
    expect(within(screen.getByTestId('col-2026-11-22')).queryAllByTestId(/^work-/)).toHaveLength(0);
    expect(screen.getByText(/Jornada do time: 08:00–12:00 \| 13:30–18:00/)).toBeTruthy();
    expect(screen.getByText('22–28 de novembro de 2026')).toBeTruthy();

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls).toContain('/api/shifts?from=2026-11-21&to=2026-11-28');
    });
  });

  it('dia: mostra só o dia e navega para o seguinte', async () => {
    mockApi();
    render(
      <AuthProvider>
        <TeamSchedulePage today="2026-11-24" />
      </AuthProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Dia' }));
    expect(await screen.findByTestId('col-2026-11-24')).toBeTruthy();
    expect(screen.queryByTestId('col-2026-11-25')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Próximo dia' }));
    const next = await screen.findByTestId('col-2026-11-25');
    expect(within(next).getByText('00:00–08:00')).toBeTruthy();
    expect(screen.getByText('quarta-feira, 25 de novembro de 2026')).toBeTruthy();
  });
});
