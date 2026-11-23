// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectiveVacationsPage } from './CollectiveVacationsPage';

const auth = vi.hoisted(() => ({ role: 'manager' as 'member' | 'manager' }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'g1', name: 'Gil', role: auth.role }, status: 'authenticated' }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const collective = {
  id: 'c1',
  userId: null,
  kind: 'collective_vacation',
  startDate: '2026-12-24',
  endDate: '2027-01-02',
  note: 'Recesso',
};

beforeEach(() => {
  auth.role = 'manager';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('férias coletivas', () => {
  it('bloqueia quem não é gestor sem chamar a API', () => {
    auth.role = 'member';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CollectiveVacationsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Apenas o gestor');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista só férias coletivas e cria sem userId, mostrando avisos', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? json(
              {
                unavailability: collective,
                warnings: [{ type: 'published_shifts_affected', date: '2026-12-25', count: 3 }],
              },
              201,
            )
          : json({
              items: [collective, { ...collective, id: 'x', kind: 'vacation', userId: 'u1' }],
            }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CollectiveVacationsPage />);
    const list = await screen.findByRole('list', { name: 'Férias coletivas' });
    expect(list.querySelectorAll('li')).toHaveLength(1);
    expect(list.textContent).toContain('24/12/2026 a 02/01/2027');
    expect(screen.queryByLabelText('Tipo')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Novas férias coletivas' }));
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-12-24' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2027-01-02' } });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      (await screen.findByRole('status', { name: 'Aviso de conflito' })).textContent,
    ).toContain('25/12/2026: 3 plantões publicados neste dia. Ajuste os plantões ou recalcule');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      kind: 'collective_vacation',
      startDate: '2026-12-24',
      endDate: '2027-01-02',
      note: null,
    });
  });

  it('edita e remove férias coletivas', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(json({ unavailability: collective }));
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(json({ items: [collective] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CollectiveVacationsPage />);
    await user.click(await screen.findByRole('button', { name: /Editar Férias coletivas/ }));
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2027-01-03' } });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(await screen.findByRole('button', { name: /Remover Férias coletivas/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await screen.findByRole('list', { name: 'Férias coletivas' });
    const calls = fetchMock.mock.calls.filter((c) => c[1]?.method && c[1].method !== 'GET');
    expect(calls[0]![0]).toBe('/api/unavailabilities/c1');
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({
      startDate: '2026-12-24',
      endDate: '2027-01-03',
      note: 'Recesso',
    });
    expect(calls[1]![1]?.method).toBe('DELETE');
  });
});
