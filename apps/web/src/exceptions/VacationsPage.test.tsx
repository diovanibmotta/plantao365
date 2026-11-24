// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VacationsPage } from './VacationsPage';

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
const individual = { ...collective, id: 'v1', kind: 'vacation', userId: 'u1', note: null };
const members = [
  { id: 'g1', name: 'Gil', active: true },
  { id: 'u1', name: 'Ana', active: true },
  { id: 'u2', name: 'Bia', active: true },
];

const mockApi = (post?: unknown) =>
  vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Promise.resolve(json(post ?? { unavailability: collective }, 201));
    if (init?.method === 'PATCH') return Promise.resolve(json({ unavailability: collective }));
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
    if (url === '/api/users') return Promise.resolve(json(members));
    return Promise.resolve(
      json({ items: [collective, individual, { ...individual, id: 'o', kind: 'time_off' }] }),
    );
  });

const posted = (fetchMock: ReturnType<typeof mockApi>) =>
  JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1]?.body));

const fillDates = () => {
  fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-12-24' } });
  fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2027-01-02' } });
};

beforeEach(() => {
  auth.role = 'manager';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('férias', () => {
  it('bloqueia quem não é gestor sem chamar a API', () => {
    auth.role = 'member';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<VacationsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Apenas o gestor');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista férias individuais e coletivas, sem folgas', async () => {
    vi.stubGlobal('fetch', mockApi());
    render(<VacationsPage />);
    const list = await screen.findByRole('list', { name: 'Férias' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('Todo o time');
  });

  it('cria coletiva para todo o time sem userIds, mostrando avisos', async () => {
    const fetchMock = mockApi({
      unavailability: collective,
      warnings: [{ type: 'published_shifts_affected', date: '2026-12-25', count: 3 }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<VacationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Novas férias' }));
    await user.selectOptions(screen.getByLabelText('Tipo de férias'), 'collective');
    fillDates();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      (await screen.findByRole('status', { name: 'Aviso de conflito' })).textContent,
    ).toContain('25/12/2026: 3 plantões publicados neste dia');
    expect(posted(fetchMock)).toEqual({
      kind: 'collective_vacation',
      startDate: '2026-12-24',
      endDate: '2027-01-02',
      note: null,
    });
  });

  it('cria coletiva só para os membros escolhidos', async () => {
    const fetchMock = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<VacationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Novas férias' }));
    await user.selectOptions(screen.getByLabelText('Tipo de férias'), 'collective');
    await user.click(screen.getByLabelText('Membros específicos'));
    fillDates();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Selecione ao menos um membro',
    );

    await user.click(screen.getByLabelText('Ana'));
    await user.click(screen.getByLabelText('Bia'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() => expect(posted(fetchMock).userIds).toEqual(['u1', 'u2']));
    expect(posted(fetchMock).kind).toBe('collective_vacation');
  });

  it('cria férias individual para o membro escolhido', async () => {
    const fetchMock = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<VacationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Novas férias' }));
    await user.selectOptions(await screen.findByLabelText('Membro'), 'u1');
    fillDates();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true),
    );
    expect(posted(fetchMock)).toMatchObject({ kind: 'vacation', userId: 'u1' });
  });

  it('edita e remove férias coletivas', async () => {
    const fetchMock = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<VacationsPage />);
    await user.click(await screen.findByRole('button', { name: /Editar Férias coletivas/ }));
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2027-01-03' } });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(await screen.findByRole('button', { name: /Remover Férias coletivas/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await screen.findByRole('list', { name: 'Férias' });
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
