// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { TeamProvider } from '../team/TeamContext';
import type { AuthUser } from '../auth/AuthContext';
import { MemberForm } from '../members/MemberForm';
import type { Member } from '../members/types';
import { MembersPage } from './MembersPage';

const member = (id: string, extra: Partial<Member> = {}): Member => ({
  id,
  name: `Pessoa ${id}`,
  email: `p${id}@example.com`,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  linked: true,
  teamIds: ['t1'],
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ME = {
  id: '1',
  email: 'a@b.c',
  name: 'Ana',
  role: 'manager',
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
  isMaster: false,
};

const TEAMS = [
  { id: 't1', name: 'Infra', role: 'manager' },
  { id: 't2', name: 'Dados', role: 'member' },
];

type Handler = (url: string, init: RequestInit | undefined) => Response;

interface Options {
  /** Membros de cada equipe (GET /api/teams/:id/members). */
  memberships?: Record<string, unknown[]>;
  handler?: Handler;
}

function mockApi(
  users: Member[],
  { memberships = {}, handler = () => json({}, 500) }: Options = {},
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (url === '/api/users') return Promise.resolve(json(users));
      if (url === '/auth/me') return Promise.resolve(json(ME));
      if (url === '/api/teams') return Promise.resolve(json(TEAMS));
      const m = /^\/api\/teams\/([^/]+)\/members$/.exec(url);
      if (m) return Promise.resolve(json(memberships[m[1]!] ?? []));
    }
    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter((c) => ((c as [string, RequestInit?])[1]?.method ?? 'GET') !== 'GET')
    .map((c) => {
      const [url, init] = c as [string, RequestInit];
      return {
        url,
        method: init.method,
        body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      };
    });

function renderApp(path: string, withTeams = false) {
  const routes = (
    <>
      <Routes>
        <Route path="/members" element={<MembersPage />} />
        <Route path="/members/new" element={<MemberForm />} />
        <Route path="/members/:id" element={<MemberForm />} />
      </Routes>
      <ToastViewport />
    </>
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      {withTeams ? (
        <AuthProvider>
          <TeamProvider>{routes}</TeamProvider>
        </AuthProvider>
      ) : (
        routes
      )}
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('listagem de membros', () => {
  it('lista membros com situação, aguardando primeiro acesso e sem equipe', async () => {
    mockApi([
      member('1', { name: 'Zeca' }),
      member('2', { name: 'Ana', linked: false, teamIds: [] }),
      member('3', { name: 'Bia', active: false }),
    ]);
    renderApp('/members');
    const table = await screen.findByRole('table', { name: 'Membros' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Ana')).toBeTruthy();
    expect(within(rows[1]!).getByText('Aguardando primeiro acesso')).toBeTruthy();
    expect(within(rows[1]!).getByText('Sem equipe')).toBeTruthy();
    expect(within(rows[2]!).getByText('Inativo')).toBeTruthy();
    expect(screen.getByText('3 de 3 registros')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Novo membro' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Editar Zeca' }).getAttribute('href')).toBe(
      '/members/1',
    );
    expect(screen.queryByRole('button', { name: /Desativar/ })).toBeNull();
  });

  it('busca por nome ou e-mail sem diferenciar acento e caixa', async () => {
    mockApi([
      member('1', { name: 'José Álvares', email: 'jose@example.com' }),
      member('2', { name: 'Ana', email: 'ana@corp.com' }),
    ]);
    const user = userEvent.setup();
    renderApp('/members');
    await screen.findByRole('table');
    const search = screen.getByLabelText('Buscar por nome ou e-mail');
    await user.type(search, 'jose alvares');
    expect(screen.getByText('José Álvares')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('1 de 2 registros')).toBeTruthy();
    await user.clear(search);
    await user.type(search, 'CORP.com');
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('José Álvares')).toBeNull();
  });

  it('filtra por situação, acesso e equipe e limpa os filtros', async () => {
    mockApi([
      member('1', { name: 'Ativa' }),
      member('2', { name: 'Inativa', active: false }),
      member('3', { name: 'Pendente', linked: false, teamIds: [] }),
    ]);
    const user = userEvent.setup();
    renderApp('/members', true);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Situação'), 'inactive');
    expect(screen.getByText('Inativa')).toBeTruthy();
    expect(screen.queryByText('Ativa')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Acesso'), 'pending');
    expect(screen.getByText('Pendente')).toBeTruthy();
    expect(screen.queryByText('Ativa')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(await screen.findByLabelText('Equipe'), 'none');
    expect(screen.getByText('Pendente')).toBeTruthy();
    expect(screen.queryByText('Inativa')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Equipe'), 't1');
    expect(screen.queryByText('Pendente')).toBeNull();
    expect(screen.getByText('2 de 3 registros')).toBeTruthy();
  });

  it('avisa quando os filtros zeram a lista', async () => {
    mockApi([member('1', { name: 'Ana' })]);
    const user = userEvent.setup();
    renderApp('/members');
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Buscar por nome ou e-mail'), 'zzz');
    expect(screen.getByText('Nenhum registro encontrado para os filtros aplicados.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('mostra estado vazio com o CTA e sem barra de filtros', async () => {
    mockApi([]);
    renderApp('/members');
    expect(await screen.findByText(/Pré-cadastre os membros/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Novo membro' })).toHaveLength(1);
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('mostra erro ao carregar a lista', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ message: 'falhou' }, 500))),
    );
    renderApp('/members');
    expect((await screen.findByRole('alert')).textContent).toBe('falhou');
  });

  it('o CTA e a linha levam ao formulário', async () => {
    mockApi([member('1', { name: 'Ana' })]);
    const user = userEvent.setup();
    renderApp('/members');
    await user.click(await screen.findByText('Ana'));
    expect(await screen.findByRole('heading', { name: 'Editar membro' })).toBeTruthy();
  });
});

describe('formulário de membro: criação', () => {
  it('pré-cadastra enviando só nome e e-mail e volta à listagem', async () => {
    const created = member('9', {
      name: 'Nova',
      email: 'nova@example.com',
      linked: false,
      teamIds: [],
    });
    const fetchMock = mockApi([member('1')], { handler: () => json(created, 201) });
    const user = userEvent.setup();
    renderApp('/members/new');
    await user.type(await screen.findByLabelText('Nome'), ' Nova ');
    await user.type(screen.getByLabelText('E-mail'), 'nova@example.com');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(
      await screen.findByText(
        'Nova foi pré-cadastrado. Vincule-o a uma equipe aqui ou em Equipes.',
      ),
    ).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/users', method: 'POST', body: { name: 'Nova', email: 'nova@example.com' } },
    ]);
    expect(await screen.findByRole('heading', { name: 'Membros' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
  });

  it('pré-cadastra já vinculando às equipes que o usuário gerencia', async () => {
    const created = member('9', { name: 'Nova', linked: false, teamIds: ['t1'] });
    const fetchMock = mockApi([member('1')], { handler: () => json(created, 201) });
    const user = userEvent.setup();
    renderApp('/members/new', true);
    expect(await screen.findByLabelText('Vincular a Infra')).toBeTruthy();
    expect(screen.queryByLabelText('Vincular a Dados')).toBeNull();
    await user.type(screen.getByLabelText('Nome'), 'Nova');
    await user.type(screen.getByLabelText('E-mail'), 'nova@example.com');
    await user.click(screen.getByLabelText('Vincular a Infra'));
    await user.selectOptions(screen.getByLabelText('Papel em Infra'), 'manager');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/foi pré-cadastrado e vinculado às equipes/)).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      {
        url: '/api/users',
        method: 'POST',
        body: {
          name: 'Nova',
          email: 'nova@example.com',
          teams: [{ teamId: 't1', role: 'manager', participatesInRotation: false }],
        },
      },
    ]);
  });

  it('valida campos obrigatórios sem chamar a API', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    renderApp('/members/new');
    await user.type(await screen.findByLabelText('E-mail'), 'invalido');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText('Informe o nome.')).toBeTruthy();
    expect(screen.getByText('E-mail inválido.')).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('mostra mensagem clara para e-mail duplicado (409) e mantém o formulário', async () => {
    mockApi([], { handler: () => json({ error: 'email_in_use', message: 'duplicado' }, 409) });
    const user = userEvent.setup();
    renderApp('/members/new');
    await user.type(await screen.findByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Já existe um usuário com este e-mail.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Novo membro' })).toBeTruthy();
  });

  it('cancelar volta à listagem sem gravar', async () => {
    const fetchMock = mockApi([member('1')]);
    const user = userEvent.setup();
    renderApp('/members/new');
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('heading', { name: 'Membros' })).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

describe('formulário de membro: edição', () => {
  it('mostra registro inexistente em vez de tela em branco', async () => {
    mockApi([member('1')]);
    const user = userEvent.setup();
    renderApp('/members/xyz');
    expect((await screen.findByRole('alert')).textContent).toBe('Membro não encontrado.');
    await user.click(screen.getByRole('button', { name: 'Voltar para a listagem' }));
    expect(await screen.findByRole('heading', { name: 'Membros' })).toBeTruthy();
  });

  it('carrega pela API, bloqueia o e-mail e salva o nome', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], {
      handler: () => json(member('1', { name: 'Ana Maria' })),
    });
    const user = userEvent.setup();
    renderApp('/members/1');
    const name = await screen.findByLabelText('Nome');
    expect((name as HTMLInputElement).value).toBe('Ana');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).readOnly).toBe(true);
    await user.clear(name);
    await user.type(name, 'Ana Maria');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Membro salvo.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/users/1', method: 'PATCH', body: { name: 'Ana Maria' } },
    ]);
  });

  it('vincula, altera e desvincula equipes', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], {
      memberships: {
        t1: [
          {
            id: '1',
            name: 'Ana',
            email: 'p1@example.com',
            active: true,
            role: 'member',
            participatesInRotation: true,
          },
        ],
      },
      handler: () => json({}),
    });
    const user = userEvent.setup();
    renderApp('/members/1', true);
    const link = await screen.findByLabelText('Vincular a Infra');
    await vi.waitFor(() => expect((link as HTMLInputElement).checked).toBe(true));
    await user.selectOptions(screen.getByLabelText('Papel em Infra'), 'manager');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Membro salvo.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      {
        url: '/api/teams/t1/members/1',
        method: 'PUT',
        body: { role: 'manager', participatesInRotation: false },
      },
    ]);
  });

  it('desvincula a equipe desmarcando o vínculo', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], {
      memberships: {
        t1: [{ id: '1', role: 'member', participatesInRotation: true }],
      },
      handler: () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderApp('/members/1', true);
    const link = await screen.findByLabelText('Vincular a Infra');
    await vi.waitFor(() => expect((link as HTMLInputElement).checked).toBe(true));
    await user.click(link);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Membro salvo.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/teams/t1/members/1', method: 'DELETE', body: undefined },
    ]);
  });

  it('mostra o link de acesso do pré-cadastro que ainda não entrou', async () => {
    mockApi([member('1', { name: 'Ana', linked: false })]);
    renderApp('/members/1');
    expect(((await screen.findByLabelText('Link de acesso')) as HTMLInputElement).value).toBe(
      `${window.location.origin}/login`,
    );
    expect(screen.getByText('Aguardando primeiro acesso')).toBeTruthy();
  });

  it('não mostra o link de acesso de quem já entrou', async () => {
    mockApi([member('1', { name: 'Ana' })]);
    renderApp('/members/1');
    await screen.findByLabelText('Nome');
    expect(screen.queryByLabelText('Link de acesso')).toBeNull();
  });

  it('só desativa após confirmar e volta à listagem', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], {
      handler: () => json(member('1', { name: 'Ana', active: false })),
    });
    const user = userEvent.setup();
    renderApp('/members/1');
    await user.click(await screen.findByRole('button', { name: 'Desativar' }));
    expect(writes(fetchMock)).toHaveLength(0);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/perde o acesso/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByText('Ana foi desativado.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/users/1', method: 'PATCH', body: { active: false } },
    ]);
    expect(await screen.findByRole('heading', { name: 'Membros' })).toBeTruthy();
  });

  it('ativa um membro inativo sem confirmação e não oferece desativar', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana', active: false })], {
      handler: () => json(member('1', { name: 'Ana' })),
    });
    const user = userEvent.setup();
    renderApp('/members/1');
    expect(await screen.findByText('Inativo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desativar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ativar membro' }));
    expect(await screen.findByText('Ana foi ativado.')).toBeTruthy();
    expect(writes(fetchMock)[0]?.body).toEqual({ active: true });
    expect(await screen.findByRole('button', { name: 'Desativar' })).toBeTruthy();
  });

  it('mostra erro de último gestor ao desativar e mantém o formulário', async () => {
    mockApi([member('1', { name: 'Ana' })], {
      handler: () => json({ error: 'last_manager', message: 'x' }, 409),
    });
    const user = userEvent.setup();
    renderApp('/members/1');
    await user.click(await screen.findByRole('button', { name: 'Desativar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }));
    expect(
      await screen.findByText(
        'Não é possível remover, rebaixar ou desativar o último gestor ativo da equipe.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Editar membro' })).toBeTruthy();
  });

  it('lista os plantões futuros que bloqueiam a desativação', async () => {
    mockApi([member('1', { name: 'Ana' })], {
      handler: () =>
        json(
          {
            error: 'has_future_published_shifts',
            message: 'm',
            shifts: [
              {
                shiftId: 's1',
                date: '2026-06-20',
                scheduleId: 'sc1',
                scheduleStart: '2026-06-01',
                scheduleEnd: '2026-06-30',
              },
            ],
          },
          409,
        ),
    });
    const user = userEvent.setup();
    renderApp('/members/1');
    await user.click(await screen.findByRole('button', { name: 'Desativar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByText('20/06/2026 (escala de 01/06/2026 a 30/06/2026)')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
  });
});

describe('guarda de rota', () => {
  it('membro comum não vê a página', async () => {
    const me: AuthUser = { ...ME, role: 'member', name: 'Membro' } as AuthUser;
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url === '/auth/me' ? json(me) : json([])),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/members']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('navigation');
    expect(screen.queryByRole('link', { name: 'Novo membro' })).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });
});
