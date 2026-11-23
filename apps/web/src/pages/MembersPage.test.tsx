// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/AuthContext';
import { MembersPage } from './MembersPage';
import type { Member } from '../members/types';

const member = (id: string, extra: Partial<Member> = {}): Member => ({
  id,
  name: `Pessoa ${id}`,
  email: `p${id}@example.com`,
  role: 'member',
  active: true,
  participatesInRotation: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  linked: true,
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Handler = (url: string, init: RequestInit | undefined) => Response;

function mockApi(users: Member[], handler: Handler = () => json({}, 500)) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      url === '/api/users' && (init?.method ?? 'GET') === 'GET' ? json(users) : handler(url, init),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter((c) => ((c as [string, RequestInit?])[1]?.method ?? 'GET') !== 'GET')
    .map((c) => {
      const [url, init] = c as [string, RequestInit];
      return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
    });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tela de membros', () => {
  it('lista membros com papel, rodízio, status e aguardando primeiro acesso', async () => {
    mockApi([
      member('1', { name: 'Zeca', role: 'manager', participatesInRotation: false }),
      member('2', { name: 'Ana', linked: false }),
      member('3', { name: 'Bia', active: false }),
    ]);
    render(<MembersPage />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Ana')).toBeTruthy();
    expect(within(rows[1]!).getByText('Aguardando primeiro acesso')).toBeTruthy();
    expect(within(rows[2]!).getByText('Inativo')).toBeTruthy();
    expect((screen.getByLabelText('Papel de Zeca') as HTMLSelectElement).value).toBe('manager');
    expect((screen.getByLabelText('Participa do rodízio: Zeca') as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('pré-cadastra enviando o payload com padrão pelo papel', async () => {
    const created = member('9', { name: 'Nova', email: 'nova@example.com', linked: false });
    const fetchMock = mockApi([member('1')], () => json(created, 201));
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(await screen.findByRole('button', { name: 'Pré-cadastrar membro' }));
    const form = screen.getByRole('form', { name: 'Pré-cadastro de membro' });
    await user.type(within(form).getByLabelText('Nome'), ' Nova ');
    await user.type(within(form).getByLabelText('E-mail'), 'nova@example.com');
    const participates = within(form).getByLabelText('Participa do rodízio') as HTMLInputElement;
    expect(participates.checked).toBe(true);
    await user.selectOptions(within(form).getByLabelText('Papel'), 'manager');
    expect(participates.checked).toBe(false);
    await user.click(within(form).getByRole('button', { name: 'Pré-cadastrar' }));
    expect(await screen.findByText('Nova foi pré-cadastrado.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      {
        url: '/api/users',
        method: 'POST',
        body: {
          name: 'Nova',
          email: 'nova@example.com',
          role: 'manager',
          participatesInRotation: false,
        },
      },
    ]);
    expect(screen.getByText('Aguardando primeiro acesso')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Pré-cadastro de membro' })).toBeNull();
  });

  it('valida campos obrigatórios sem chamar a API', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(await screen.findByRole('button', { name: 'Pré-cadastrar membro' }));
    await user.type(screen.getByLabelText('E-mail'), 'invalido');
    await user.click(screen.getByRole('button', { name: 'Pré-cadastrar' }));
    expect(screen.getByText('Informe o nome.')).toBeTruthy();
    expect(screen.getByText('E-mail inválido.')).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('mostra mensagem clara para e-mail duplicado (409)', async () => {
    mockApi([], () => json({ error: 'email_in_use', message: 'duplicado' }, 409));
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(await screen.findByRole('button', { name: 'Pré-cadastrar membro' }));
    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Pré-cadastrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Já existe um usuário com este e-mail.',
    );
    expect(screen.getByRole('form', { name: 'Pré-cadastro de membro' })).toBeTruthy();
  });

  it('altera papel e participação no rodízio', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], (url, init) => {
      const patch = JSON.parse(String(init?.body)) as Partial<Member>;
      return json(member('1', { name: 'Ana', ...patch }));
    });
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.selectOptions(await screen.findByLabelText('Papel de Ana'), 'manager');
    expect(await screen.findByText('Papel de Ana atualizado.')).toBeTruthy();
    await user.click(screen.getByLabelText('Participa do rodízio: Ana'));
    expect(await screen.findByText('Rodízio de Ana atualizado.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/users/1', method: 'PATCH', body: { role: 'manager' } },
      { url: '/api/users/1', method: 'PATCH', body: { participatesInRotation: false } },
    ]);
  });

  it('pede confirmação antes de desativar e envia active=false', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], () =>
      json(member('1', { name: 'Ana', active: false })),
    );
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(await screen.findByRole('button', { name: 'Desativar Ana' }));
    expect(writes(fetchMock)).toHaveLength(0);
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Desativar Ana' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar desativação' }));
    expect(await screen.findByText('Ana foi desativado.')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/users/1', method: 'PATCH', body: { active: false } },
    ]);
    expect(screen.getByRole('button', { name: 'Ativar Ana' })).toBeTruthy();
  });

  it('ativa sem confirmação', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana', active: false })], () =>
      json(member('1', { name: 'Ana' })),
    );
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(await screen.findByRole('button', { name: 'Ativar Ana' }));
    expect(await screen.findByText('Ana foi ativado.')).toBeTruthy();
    expect(writes(fetchMock)[0]?.body).toEqual({ active: true });
  });

  it('mostra erro de último gestor e mensagem genérica de 409', async () => {
    let call = 0;
    mockApi([member('1', { name: 'Ana', role: 'manager' })], () => {
      call += 1;
      return call === 1
        ? json({ error: 'last_manager', message: 'x' }, 409)
        : json({ error: 'future_shifts', message: 'Ana tem plantões futuros publicados.' }, 409);
    });
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.selectOptions(await screen.findByLabelText('Papel de Ana'), 'member');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não é possível remover ou desativar o último gestor ativo.',
    );
    await user.click(screen.getByRole('button', { name: 'Desativar Ana' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar desativação' }));
    expect(await screen.findByText('Ana tem plantões futuros publicados.')).toBeTruthy();
  });

  it('mostra erro ao carregar a lista', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ message: 'falhou' }, 500))),
    );
    render(<MembersPage />);
    expect((await screen.findByRole('alert')).textContent).toBe('falhou');
  });

  it('membro comum não vê a página (guarda de rota)', async () => {
    const me: AuthUser = {
      id: '1',
      email: 'a@b.c',
      name: 'Membro',
      role: 'member',
      phone: null,
      participatesInRotation: true,
      remindersEnabled: true,
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url === '/auth/me' ? json(me) : json([])),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/equipe']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Pré-cadastrar membro' })).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });
});
