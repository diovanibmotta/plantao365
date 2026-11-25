// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImpactConfirmDialog } from '../api/ImpactConfirmDialog';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { ExceptionsSection } from './ExceptionsSection';
import { MemberExceptionForm } from './MemberExceptionForm';
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

function renderApp(path = '/profile') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile" element={<ExceptionsSection />} />
        <Route path="/profile/exceptions/new" element={<MemberExceptionForm />} />
        <Route path="/profile/exceptions/:id" element={<MemberExceptionForm />} />
      </Routes>
      <ToastViewport />
      <ImpactConfirmDialog />
    </MemoryRouter>,
  );
}

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

describe('exceções do membro: listagem', () => {
  it('lista só exceções individuais, com período e observação', async () => {
    mockApi(() =>
      json({
        items: [
          item('a', { note: 'Viagem' }),
          item('c', { kind: 'collective_vacation', userId: null }),
          item('b', { userId: 'u2' }),
        ],
      }),
    );
    renderApp();
    const table = await screen.findByRole('table', { name: 'Exceções' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toContain('Férias');
    expect(rows[1]!.textContent).toContain('01/07/2026 a 10/07/2026');
    expect(rows[1]!.textContent).toContain('Viagem');
    expect(formatPeriod('2026-07-01', '2026-07-01')).toBe('01/07/2026');
    expect(screen.queryByLabelText('Membro')).toBeNull();
  });

  it('busca e filtra por tipo', async () => {
    mockApi(() =>
      json({
        items: [
          item('a', { kind: 'time_off', note: 'Médico' }),
          item('b', { kind: 'other', note: 'Viagem' }),
        ],
      }),
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Médico');
    await user.type(screen.getByRole('searchbox'), 'medico');
    expect(screen.queryByText('Viagem')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Tipo'), 'other');
    expect(screen.queryByText('Médico')).toBeNull();
    expect(screen.getByText('1 de 2 registros')).toBeTruthy();
  });

  it('mostra estado vazio com CTA e erro de carregamento', async () => {
    mockApi(() => json({ items: [] }));
    renderApp();
    expect(await screen.findByText(/Cadastre os períodos/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nova exceção' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    cleanup();
    mockApi(() => json({ error: 'x', message: 'Falha no servidor' }, 500));
    renderApp();
    expect((await screen.findByRole('alert')).textContent).toBe('Falha no servidor');
  });

  it('gestor no Perfil vê só as próprias exceções e não consulta membros', async () => {
    auth.role = 'manager';
    const fetchMock = mockApi((url) =>
      url === '/api/users'
        ? json(MEMBERS)
        : json({ items: [item('a', { note: 'Casamento' }), item('b', { userId: 'u2' })] }),
    );
    renderApp();
    const table = await screen.findByRole('table', { name: 'Exceções' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Casamento')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });
});

describe('exceções do membro: formulário', () => {
  it('valida fim >= início no cliente sem chamar a API', async () => {
    const fetchMock = mockApi(() => json({ items: [] }));
    const user = userEvent.setup();
    renderApp('/profile/exceptions/new');
    await screen.findByRole('heading', { name: 'Nova exceção' });
    setDates('2026-07-10', '2026-07-01');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('não pode ser anterior');
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('não oferece Férias ao criar, mas mantém ao editar registro antigo de férias', async () => {
    mockApi(() => json({ items: [item('a')] }));
    renderApp('/profile/exceptions/new');
    const optionsOf = () =>
      within(screen.getByLabelText('Tipo'))
        .getAllByRole('option')
        .map((o) => o.textContent);
    await screen.findByRole('heading', { name: 'Nova exceção' });
    expect(optionsOf()).toEqual(['Folga', 'Outro']);
    cleanup();
    renderApp('/profile/exceptions/a');
    await screen.findByRole('heading', { name: 'Editar exceção' });
    expect(optionsOf()).toEqual(['Férias', 'Folga', 'Outro']);
  });

  it('plantão publicado afetado: pede confirmação (Sim/Não) antes de salvar', async () => {
    const created = item('n', { kind: 'time_off', note: 'Médico' });
    const impact = {
      error: 'schedule_impact_confirmation_required',
      message: '1 plantão publicado em conflito com esta exceção de disponibilidade.',
      scheduleImpact: { dates: ['2026-07-03'], shifts: 1 },
    };
    const fetchMock = mockApi((url, init) => {
      if (init?.method !== 'POST') return json({ items: [] });
      return url.includes('confirmImpact=true')
        ? json({ unavailability: created }, 201)
        : json(impact, 409);
    });
    const user = userEvent.setup();
    renderApp('/profile/exceptions/new');
    await user.selectOptions(await screen.findByLabelText('Tipo'), 'time_off');
    setDates('2026-07-01', '2026-07-10');
    await user.type(screen.getByLabelText('Observação (opcional)'), 'Médico');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('1 plantão publicado em conflito');
    expect(dialog.textContent).toContain('03/07/2026');
    expect(dialog.textContent).toContain('Deseja continuar?');

    // Não: nada é salvo e o usuário continua no formulário
    await user.click(within(dialog).getByRole('button', { name: 'Não' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nova exceção' })).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(1);

    // Sim: repete a chamada confirmando o impacto
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sim' }),
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nova exceção' })).toBeNull());
    const calls = writes(fetchMock);
    expect(calls.map((c) => c[0])).toEqual([
      '/api/unavailabilities',
      '/api/unavailabilities',
      '/api/unavailabilities?confirmImpact=true',
    ]);
    expect(JSON.parse(String(calls[2]![1].body))).toEqual({
      kind: 'time_off',
      startDate: '2026-07-01',
      endDate: '2026-07-10',
      note: 'Médico',
    });
  });

  it('edita com PATCH', async () => {
    const fetchMock = mockApi((_url, init) =>
      init?.method === 'PATCH'
        ? json({ unavailability: item('a'), warnings: [] })
        : json({ items: [item('a')] }),
    );
    const user = userEvent.setup();
    renderApp('/profile/exceptions/a');
    await screen.findByRole('heading', { name: 'Editar exceção' });
    setDates('2026-07-02', '2026-07-12');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('table', { name: 'Exceções' });
    const [patch] = writes(fetchMock);
    expect(patch![0]).toBe('/api/unavailabilities/a');
    expect(patch![1].method).toBe('PATCH');
    expect(JSON.parse(String(patch![1].body))).toMatchObject({
      kind: 'vacation',
      startDate: '2026-07-02',
      endDate: '2026-07-12',
    });
  });

  it('só exclui depois de confirmar', async () => {
    const fetchMock = mockApi((_url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json({ items: [item('a')] }),
    );
    const user = userEvent.setup();
    renderApp('/profile/exceptions/a');
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    expect(writes(fetchMock)).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    await screen.findByRole('table', { name: 'Exceções' });
    const [del] = writes(fetchMock);
    expect(del![0]).toBe('/api/unavailabilities/a');
    expect(del![1].method).toBe('DELETE');
  });

  it('exibe o erro da API (toast) e permanece no formulário ao falhar a exclusão', async () => {
    mockApi((_url, init) =>
      init?.method === 'DELETE'
        ? json({ error: 'x', message: 'Sem permissão' }, 404)
        : json({ items: [item('a')] }),
    );
    const user = userEvent.setup();
    renderApp('/profile/exceptions/a');
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Sem permissão');
    expect(screen.getByRole('heading', { name: 'Editar exceção' })).toBeTruthy();
  });

  it('mostra mensagem para registro inexistente ou de outro membro', async () => {
    mockApi(() => json({ items: [item('b', { userId: 'u2' })] }));
    renderApp('/profile/exceptions/b');
    expect((await screen.findByRole('alert')).textContent).toContain('não encontrada');
    expect(screen.getByRole('button', { name: 'Voltar para a listagem' })).toBeTruthy();
  });

  it('membro não consulta /api/users nem escolhe membro', async () => {
    const fetchMock = mockApi(() => json({ items: [] }));
    renderApp('/profile/exceptions/new');
    await screen.findByRole('heading', { name: 'Nova exceção' });
    expect(screen.queryByLabelText('Membro')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });
});
