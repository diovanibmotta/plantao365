// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
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
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  linked: true,
  teamIds: ['t1'],
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
  toast.clear();
  vi.unstubAllGlobals();
});

describe('tela de membros', () => {
  it('lista membros com status, aguardando primeiro acesso e sem equipe', async () => {
    mockApi([
      member('1', { name: 'Zeca' }),
      member('2', { name: 'Ana', linked: false, teamIds: [] }),
      member('3', { name: 'Bia', active: false }),
    ]);
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('Ana')).toBeTruthy();
    expect(within(rows[1]!).getByText('Aguardando primeiro acesso')).toBeTruthy();
    expect(within(rows[1]!).getByText('Sem equipe')).toBeTruthy();
    expect(within(rows[2]!).getByText('Inativo')).toBeTruthy();
    expect(screen.queryByLabelText('Papel de Zeca')).toBeNull();
    expect(screen.queryByLabelText('Participa do rodízio: Zeca')).toBeNull();
  });

  it('pré-cadastra enviando só nome e e-mail', async () => {
    const created = member('9', {
      name: 'Nova',
      email: 'nova@example.com',
      linked: false,
      teamIds: [],
    });
    const fetchMock = mockApi([member('1')], () => json(created, 201));
    const user = userEvent.setup();
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Pré-cadastrar membro' }));
    const form = screen.getByRole('form', { name: 'Pré-cadastro de membro' });
    await user.type(within(form).getByLabelText('Nome'), ' Nova ');
    await user.type(within(form).getByLabelText('E-mail'), 'nova@example.com');
    expect(within(form).queryByLabelText('Papel')).toBeNull();
    expect(within(form).queryByLabelText('Participa do rodízio')).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Pré-cadastrar' }));
    expect(
      await screen.findByText('Nova foi pré-cadastrado. Vincule-o a uma equipe em Equipes.'),
    ).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      { url: '/api/users', method: 'POST', body: { name: 'Nova', email: 'nova@example.com' } },
    ]);
    expect(screen.getByText('Aguardando primeiro acesso')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Pré-cadastro de membro' })).toBeNull();
  });

  it('valida campos obrigatórios sem chamar a API', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
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
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Pré-cadastrar membro' }));
    await user.type(screen.getByLabelText('Nome'), 'Ana');
    await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Pré-cadastrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Já existe um usuário com este e-mail.',
    );
    expect(screen.getByRole('form', { name: 'Pré-cadastro de membro' })).toBeTruthy();
  });

  it('pede confirmação antes de desativar e envia active=false', async () => {
    const fetchMock = mockApi([member('1', { name: 'Ana' })], () =>
      json(member('1', { name: 'Ana', active: false })),
    );
    const user = userEvent.setup();
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
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
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Ativar Ana' }));
    expect(await screen.findByText('Ana foi ativado.')).toBeTruthy();
    expect(writes(fetchMock)[0]?.body).toEqual({ active: true });
  });

  it('mostra erro de último gestor e mensagem genérica de 409', async () => {
    let call = 0;
    mockApi([member('1', { name: 'Ana' })], () => {
      call += 1;
      return call === 1
        ? json({ error: 'last_manager', message: 'x' }, 409)
        : json({ error: 'future_shifts', message: 'Ana tem plantões futuros publicados.' }, 409);
    });
    const user = userEvent.setup();
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Desativar Ana' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar desativação' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não é possível remover, rebaixar ou desativar o último gestor ativo da equipe.',
    );
    await user.click(screen.getByRole('button', { name: 'Desativar Ana' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar desativação' }));
    expect(await screen.findByText('Ana tem plantões futuros publicados.')).toBeTruthy();
  });

  it('lista os plantões futuros que bloqueiam a desativação', async () => {
    mockApi([member('1', { name: 'Ana' })], () =>
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
    );
    const user = userEvent.setup();
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Desativar Ana' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar desativação' }));
    expect(await screen.findByText('20/06/2026 (escala de 01/06/2026 a 30/06/2026)')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
  });

  it('mostra erro ao carregar a lista', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ message: 'falhou' }, 500))),
    );
    render(
      <>
        <MembersPage />
        <ToastViewport />
      </>,
    );
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
      isMaster: false,
    };
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
    expect(screen.queryByRole('button', { name: 'Pré-cadastrar membro' })).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/users')).toBe(false);
  });
});
