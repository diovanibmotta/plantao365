// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { ExceptionsSection } from './ExceptionsSection';
import { formatPeriod } from './types';

const auth = vi.hoisted(() => ({ role: 'member' as 'member' | 'manager' }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Ana', role: auth.role }, status: 'authenticated' }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  kind: 'vacation',
  startDate: '2026-07-01',
  endDate: '2026-07-10',
  note: null,
  ...over,
});

const MEMBERS = [
  { id: 'u1', name: 'Ana', active: true },
  { id: 'u2', name: 'Bruno', active: true },
];

type Handler = (url: string, init?: RequestInit) => Response;

function mockApi(handler: Handler) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'GET') as [
    string,
    RequestInit,
  ][];

const setDates = (start: string, end: string) => {
  fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Data final'), { target: { value: end } });
};

beforeEach(() => {
  auth.role = 'member';
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('exceções do membro', () => {
  it('lista só exceções individuais, com período e observação', async () => {
    mockApi(() =>
      json({
        items: [
          item('a', { note: 'Viagem' }),
          item('c', { kind: 'collective_vacation', userId: null }),
        ],
      }),
    );
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Exceções' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Férias: 01/07/2026 a 10/07/2026');
    expect(rows[0]!.textContent).toContain('Viagem');
    expect(formatPeriod('2026-07-01', '2026-07-01')).toBe('01/07/2026');
  });

  it('mostra estado vazio e erro de carregamento', async () => {
    mockApi(() => json({ items: [] }));
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    expect(await screen.findByText('Nenhuma exceção cadastrada.')).toBeTruthy();
    cleanup();
    mockApi(() => json({ error: 'x', message: 'Falha no servidor' }, 500));
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Falha no servidor');
  });

  it('valida fim >= início no cliente sem chamar a API', async () => {
    const fetchMock = mockApi(() => json({ items: [] }));
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Nova exceção' }));
    setDates('2026-07-10', '2026-07-01');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('não pode ser anterior');
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('não oferece Férias ao criar exceção, mas mantém ao editar registro antigo de férias', async () => {
    mockApi(() => json({ items: [item('a')] }));
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Nova exceção' }));
    const optionsOf = () =>
      within(screen.getByLabelText('Tipo'))
        .getAllByRole('option')
        .map((o) => o.textContent);
    expect(optionsOf()).toEqual(['Folga', 'Outro']);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(await screen.findByRole('button', { name: /Editar Férias/ }));
    expect(optionsOf()).toEqual(['Férias', 'Folga', 'Outro']);
  });

  it('cria exceção e mostra avisos de conflito', async () => {
    const created = item('n', { kind: 'time_off', note: 'Médico' });
    const fetchMock = mockApi((_url, init) =>
      init?.method === 'POST'
        ? json(
            {
              unavailability: created,
              warnings: [{ type: 'published_shift_conflict', date: '2026-07-03', userId: 'u1' }],
            },
            201,
          )
        : json({ items: [] }),
    );
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Nova exceção' }));
    await user.selectOptions(screen.getByLabelText('Tipo'), 'time_off');
    setDates('2026-07-01', '2026-07-10');
    await user.type(screen.getByLabelText(/Observação/), 'Médico');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const warning = await screen.findByRole('status', { name: 'Aviso de conflito' });
    expect(warning.textContent).toContain('03/07/2026');
    expect(warning.textContent).toContain('O gestor foi avisado por e-mail');
    const [url, init] = writes(fetchMock)[0]!;
    expect(url).toBe('/api/unavailabilities');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'time_off',
      startDate: '2026-07-01',
      endDate: '2026-07-10',
      note: 'Médico',
    });
    await user.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByRole('status', { name: 'Aviso de conflito' })).toBeNull();
  });

  it('edita com PATCH e remove com confirmação', async () => {
    const fetchMock = mockApi((_url, init) => {
      if (init?.method === 'PATCH') return json({ unavailability: item('a'), warnings: [] });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({ items: [item('a')] });
    });
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: /Editar Férias/ }));
    setDates('2026-07-02', '2026-07-12');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('list', { name: 'Exceções' });
    await user.click(screen.getByRole('button', { name: /Remover Férias/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await screen.findByRole('list', { name: 'Exceções' });
    const [patch, del] = writes(fetchMock);
    expect(patch![0]).toBe('/api/unavailabilities/a');
    expect(patch![1].method).toBe('PATCH');
    expect(JSON.parse(String(patch![1].body))).toMatchObject({
      kind: 'vacation',
      startDate: '2026-07-02',
      endDate: '2026-07-12',
    });
    expect(del![0]).toBe('/api/unavailabilities/a');
    expect(del![1].method).toBe('DELETE');
  });

  it('exibe erro da API ao falhar a remoção', async () => {
    mockApi((_url, init) =>
      init?.method === 'DELETE'
        ? json({ error: 'x', message: 'Sem permissão' }, 404)
        : json({ items: [item('a')] }),
    );
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: /Remover Férias/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Sem permissão');
  });

  it('membro não consulta /api/users nem escolhe membro', async () => {
    const fetchMock = mockApi(() => json({ items: [] }));
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Nova exceção' }));
    expect(screen.queryByLabelText('Membro')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });

  it('gestor no Perfil vê só as próprias exceções e não escolhe membro', async () => {
    auth.role = 'manager';
    const fetchMock = mockApi((url) =>
      url === '/api/users'
        ? json(MEMBERS)
        : json({ items: [item('a', { note: 'Casamento' }), item('b', { userId: 'u2' })] }),
    );
    const user = userEvent.setup();
    render(
      <>
        <ExceptionsSection />
        <ToastViewport />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Exceções' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Casamento')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Nova exceção' }));
    expect(screen.queryByLabelText('Membro')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });
});
