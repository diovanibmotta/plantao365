// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { VacationForm } from './VacationForm';
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
  startDate: '2040-12-24',
  endDate: '2041-01-02',
  note: 'Recesso',
};
const individual = {
  id: 'v1',
  userId: 'u1',
  kind: 'vacation',
  startDate: '2020-03-02',
  endDate: '2020-03-15',
  note: null,
};
const timeOff = { ...individual, id: 'o', kind: 'time_off' };
const members = [
  { id: 'g1', name: 'Gil', active: true },
  { id: 'u1', name: 'Ana', active: true },
  { id: 'u2', name: 'Bia', active: true },
];

function mockApi(items: unknown[] = [collective, individual, timeOff], post?: unknown) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Promise.resolve(json(post ?? { unavailability: collective }, 201));
    if (init?.method === 'PATCH') return Promise.resolve(json({ unavailability: collective }));
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
    if (url === '/api/users') return Promise.resolve(json(members));
    return Promise.resolve(json({ items }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter((c) => c[1]?.method && c[1].method !== 'GET');

const posted = (fetchMock: ReturnType<typeof mockApi>) =>
  JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1]?.body));

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vacations" element={<VacationsPage />} />
        <Route path="/vacations/new" element={<VacationForm />} />
        <Route path="/vacations/:id" element={<VacationForm />} />
      </Routes>
      <ToastViewport />
    </MemoryRouter>,
  );
}

const table = () => within(screen.getByRole('table', { name: 'Férias' }));
const inTable = (text: string) => table().getByText(text);
const queryInTable = (text: string) => table().queryByText(text);
const findInTable = async (text: string) => {
  await screen.findByRole('table', { name: 'Férias' });
  return table().findByText(text);
};

const fillDates = (start = '2040-12-24', end = '2041-01-02') => {
  fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Data final'), { target: { value: end } });
};

beforeEach(() => {
  auth.role = 'manager';
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('férias: listagem', () => {
  it('bloqueia quem não é gestor sem chamar a API', () => {
    auth.role = 'member';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderApp('/vacations');
    expect(screen.getByRole('alert').textContent).toContain('Apenas o gestor');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista férias individuais e coletivas, sem folgas, e não oferece exclusão', async () => {
    mockApi();
    renderApp('/vacations');
    const table = await screen.findByRole('table', { name: 'Férias' });
    expect(within(table).getAllByRole('row')).toHaveLength(3); // cabeçalho + 2
    expect(table.textContent).toContain('Todo o time');
    expect(await within(table).findByText('Ana')).toBeTruthy();
    expect(screen.getByText('2 de 2 registros')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover|Excluir/ })).toBeNull();
  });

  it('busca por membro, observação e período, sem diferenciar acento ou caixa', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('/vacations');
    await findInTable('Ana');
    await user.type(screen.getByRole('searchbox'), 'ANA');
    expect(screen.getByText('1 de 2 registros')).toBeTruthy();
    expect(screen.queryByText('Recesso')).toBeNull();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'recesso');
    expect(screen.getByText('Recesso')).toBeTruthy();
    expect(queryInTable('Ana')).toBeNull();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), '02/03/2020');
    expect(inTable('Ana')).toBeTruthy();
    expect(screen.queryByText('Recesso')).toBeNull();
  });

  it('filtra por tipo, ano, situação e membro e limpa os filtros', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('/vacations');
    await findInTable('Ana');
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Tipo'), 'collective_vacation');
    expect(queryInTable('Ana')).toBeNull();
    expect(screen.getByText('Recesso')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Ano'), '2020');
    expect(screen.queryByText('Recesso')).toBeNull();
    expect(inTable('Ana')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Situação'), 'future');
    expect(queryInTable('Ana')).toBeNull();
    expect(screen.getByText('Recesso')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Situação'), 'past');
    expect(screen.queryByText('Recesso')).toBeNull();
    expect(inTable('Ana')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Membro'), 'u2');
    expect(screen.getByText('Nenhum registro encontrado para os filtros aplicados.')).toBeTruthy();
  });

  it('mostra estado vazio com o CTA de cadastro e sem barra de filtros', async () => {
    mockApi([]);
    renderApp('/vacations');
    expect(await screen.findByText(/Cadastre as férias/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Novas férias' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('mostra erro de carregamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ error: 'x', message: 'Falha no servidor' }, 500))),
    );
    renderApp('/vacations');
    expect((await screen.findByRole('alert')).textContent).toBe('Falha no servidor');
  });

  it('o CTA abre o formulário e a linha abre a edição', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('/vacations');
    await user.click(await screen.findByRole('link', { name: 'Novas férias' }));
    expect(await screen.findByRole('heading', { name: 'Novas férias' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(await screen.findByRole('link', { name: /Editar Férias coletivas/ }));
    expect(await screen.findByRole('heading', { name: 'Editar férias' })).toBeTruthy();
  });
});

describe('férias: formulário', () => {
  it('cria coletiva para todo o time sem userIds e mostra os avisos na listagem', async () => {
    const fetchMock = mockApi([], {
      unavailability: collective,
      warnings: [{ type: 'published_shifts_affected', date: '2026-12-25', count: 3 }],
    });
    const user = userEvent.setup();
    renderApp('/vacations/new');
    await user.selectOptions(await screen.findByLabelText('Tipo de férias'), 'collective');
    fillDates();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      (await screen.findByRole('status', { name: 'Aviso de conflito' })).textContent,
    ).toContain('25/12/2026: 3 plantões publicados neste dia');
    expect(posted(fetchMock)).toEqual({
      kind: 'collective_vacation',
      startDate: '2040-12-24',
      endDate: '2041-01-02',
      note: null,
    });
    await user.click(screen.getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByRole('status', { name: 'Aviso de conflito' })).toBeNull();
  });

  it('cria coletiva só para os membros escolhidos, exigindo ao menos um', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    renderApp('/vacations/new');
    await user.selectOptions(await screen.findByLabelText('Tipo de férias'), 'collective');
    await user.click(screen.getByLabelText('Membros específicos'));
    fillDates();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Selecione ao menos um membro',
    );
    expect(writes(fetchMock)).toHaveLength(0);

    await user.click(screen.getByLabelText('Ana'));
    await user.click(screen.getByLabelText('Bia'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() => expect(posted(fetchMock).userIds).toEqual(['u1', 'u2']));
    expect(posted(fetchMock).kind).toBe('collective_vacation');
  });

  it('cria férias individual para o membro escolhido', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    renderApp('/vacations/new');
    await user.selectOptions(await screen.findByLabelText('Membro'), 'u1');
    fillDates();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    expect(posted(fetchMock)).toMatchObject({ kind: 'vacation', userId: 'u1' });
    expect(await screen.findByRole('link', { name: 'Novas férias' })).toBeTruthy();
  });

  it('valida datas no cliente sem chamar a API', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    renderApp('/vacations/new');
    await user.click(await screen.findByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Informe as datas');
    fillDates('2040-07-10', '2040-07-01');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('não pode ser anterior');
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('edita férias coletivas com PATCH e volta à listagem', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    renderApp('/vacations/c1');
    await screen.findByRole('heading', { name: 'Editar férias' });
    expect(screen.queryByLabelText('Tipo de férias')).toBeNull();
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2041-01-03' } });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('table', { name: 'Férias' });
    const [[url, init]] = writes(fetchMock);
    expect(url).toBe('/api/unavailabilities/c1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      startDate: '2040-12-24',
      endDate: '2041-01-03',
      note: 'Recesso',
    });
  });

  it('só exclui depois de confirmar e explica o efeito', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    renderApp('/vacations/c1');
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Plantões já publicados não mudam');
    expect(writes(fetchMock)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    await screen.findByRole('table', { name: 'Férias' });
    const [[url, init]] = writes(fetchMock);
    expect(url).toBe('/api/unavailabilities/c1');
    expect(init?.method).toBe('DELETE');
  });

  it('não mostra Excluir ao criar', async () => {
    mockApi([]);
    renderApp('/vacations/new');
    await screen.findByRole('heading', { name: 'Novas férias' });
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  it('mostra mensagem para registro inexistente ou de outro tipo, nunca tela em branco', async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp('/vacations/nao-existe');
    expect((await screen.findByRole('alert')).textContent).toContain('não encontrado');
    cleanup();
    renderApp('/vacations/o'); // folga: não é férias
    expect((await screen.findByRole('alert')).textContent).toContain('não encontrado');
    await user.click(screen.getByRole('button', { name: 'Voltar para a listagem' }));
    expect(await screen.findByRole('table', { name: 'Férias' })).toBeTruthy();
  });
});

describe('férias: cálculo do término', () => {
  it('calcula a data final a partir do início e da quantidade de dias', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    renderApp('/vacations/new');
    await screen.findByRole('heading', { name: 'Novas férias' });
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2040-12-24' } });
    fireEvent.change(screen.getByLabelText('Quantidade de dias'), { target: { value: '30' } });
    expect((screen.getByLabelText('Data final') as HTMLInputElement).value).toBe('2041-01-22');

    fireEvent.change(screen.getByLabelText('Quantidade de dias'), { target: { value: '1' } });
    expect((screen.getByLabelText('Data final') as HTMLInputElement).value).toBe('2040-12-24');

    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2040-12-31' } });
    expect((screen.getByLabelText('Quantidade de dias') as HTMLInputElement).value).toBe('8');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await vi.waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    expect(posted(fetchMock)).toMatchObject({ startDate: '2040-12-24', endDate: '2040-12-31' });
  });

  it('mostra os dias ao editar e recalcula o término ao mudar a quantidade', async () => {
    mockApi();
    renderApp('/vacations/c1');
    await screen.findByRole('heading', { name: 'Editar férias' });
    expect((screen.getByLabelText('Quantidade de dias') as HTMLInputElement).value).toBe('10');
    fireEvent.change(screen.getByLabelText('Quantidade de dias'), { target: { value: '5' } });
    expect((screen.getByLabelText('Data final') as HTMLInputElement).value).toBe('2040-12-28');
  });
});
