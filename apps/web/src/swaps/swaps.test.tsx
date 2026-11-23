// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SwapsPage } from '../pages/SwapsPage';
import { SwapRequestAction } from './SwapRequestAction';
import type { ShiftDto } from '../schedule/types';
import type { SwapDto } from './types';

const auth = vi.hoisted(() => ({
  user: { id: 'me', role: 'member' } as { id: string; role: 'member' | 'manager' },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const info = (id: string, date: string) => ({
  id,
  date,
  hours: 12,
  startsAt: null,
  endsAt: null,
});

const swap = (over: Partial<SwapDto>): SwapDto => ({
  id: 's1',
  kind: 'swap',
  status: 'pending',
  requesterId: 'other',
  requesterName: 'Bruno',
  counterpartId: 'me',
  counterpartName: 'Ana',
  requesterShift: info('a', '2026-03-20'),
  counterpartShift: info('b', '2026-03-25'),
  note: null,
  decisionReason: null,
  createdAt: '2026-03-01T00:00:00Z',
  ...over,
});

const shift = (id: string, date: string, userId: string, userName: string): ShiftDto => ({
  id,
  scheduleId: 'sc',
  date,
  dayType: 'weekday',
  hours: 12,
  startsAt: null,
  endsAt: null,
  userId,
  userName,
  originalUserId: null,
  originalHours: null,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user = { id: 'me', role: 'member' };
});

describe('SwapsPage', () => {
  it('colega aceita solicitação recebida e recarrega', async () => {
    let items = [swap({})];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        items = [swap({ status: 'awaiting_approval' })];
        return Promise.resolve(json({ swap: items[0] }));
      }
      return Promise.resolve(json({ items }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SwapsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
    await screen.findByText('Aguardando gestor');
    expect(fetchMock).toHaveBeenCalledWith('/api/swaps/s1/accept', expect.anything());
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
  });

  it('solicitante vê status em pt-BR e cancela', async () => {
    const items = [swap({ requesterId: 'me', counterpartId: 'other' })];
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? json({}) : json({ items })),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<SwapsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Enviadas' }));
    expect(screen.getByText('Aguardando colega')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar solicitação' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/swaps/s1/cancel', expect.anything());
  });

  it('exibe a mensagem de erro retornada pela API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? json({ error: 'conflict', message: 'Plantão já trocado' }, 422)
            : json({ items: [swap({})] }),
        ),
      ),
    );
    render(<SwapsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Recusar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Plantão já trocado');
  });

  it('membro não vê abas de gestor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ items: [] })));
    render(<SwapsPage />);
    await screen.findByText('Nenhuma solicitação recebida.');
    expect(screen.queryByRole('tab', { name: 'Aprovação' })).toBeNull();
  });

  it('gestor aprova da fila com motivo na rejeição', async () => {
    auth.user = { id: 'mgr', role: 'manager' };
    const items = [swap({ status: 'awaiting_approval' })];
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? json({}) : json({ items })),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<SwapsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Aprovação' }));
    await userEvent.type(screen.getByLabelText('Motivo (opcional)'), 'sem cobertura');
    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/swaps/s1/reject');
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      reason: 'sem cobertura',
    });
  });
});

describe('SwapRequestAction', () => {
  const mine = shift('m1', '2026-03-20', 'me', 'Ana');

  it('não aparece para plantão passado', () => {
    render(<SwapRequestAction shift={mine} today="2026-03-21" />);
    expect(screen.queryByRole('button', { name: 'Solicitar troca' })).toBeNull();
  });

  it('envia permuta com colega e plantão escolhidos', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(json({ swap: {} }, 201));
      if (url.startsWith('/api/users/colleagues')) {
        return Promise.resolve(json([{ id: 'c1', name: 'Carla' }]));
      }
      if (url.includes('userId=c1')) {
        return Promise.resolve(json([shift('t1', '2026-03-25', 'c1', 'Carla')]));
      }
      return Promise.resolve(
        json([
          mine,
          shift('t1', '2026-03-25', 'c1', 'Carla'),
          shift('x', '2026-03-26', 'me', 'Ana'),
        ]),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SwapRequestAction shift={mine} today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar troca' }));
    const colleague = await screen.findByLabelText('Colega');
    await screen.findByRole('option', { name: 'Carla' });
    expect(screen.queryByRole('option', { name: 'Ana' })).toBeNull();
    await userEvent.selectOptions(colleague, 'c1');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(4));
    await userEvent.selectOptions(screen.getByLabelText('Plantão do colega'), 't1');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    await screen.findByText(/Solicitação enviada/);
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      kind: 'swap',
      shiftId: 'm1',
      counterpartId: 'c1',
      counterpartShiftId: 't1',
    });
  });

  it('cessão não pede plantão do colega e mostra erro da API', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(json({ error: 'x', message: 'Colega indisponível' }, 422));
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(
          json([{ id: 'c1', name: 'Carla', active: true, participatesInRotation: true }]),
        );
      }
      return Promise.resolve(json([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SwapRequestAction shift={mine} today="2026-03-10" />);
    await userEvent.click(screen.getByRole('button', { name: 'Solicitar troca' }));
    await userEvent.selectOptions(await screen.findByLabelText('Tipo'), 'cession');
    expect(screen.queryByLabelText('Plantão do colega')).toBeNull();
    await screen.findByRole('option', { name: 'Carla' });
    await userEvent.selectOptions(screen.getByLabelText('Colega'), 'c1');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Colega indisponível');
  });
});
