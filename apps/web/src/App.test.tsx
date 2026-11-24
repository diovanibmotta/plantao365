// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import type { AuthUser } from './auth/AuthContext';

const user = (role: AuthUser['role']): AuthUser => ({
  id: '1',
  email: 'a@b.c',
  name: 'Ana Souza',
  role,
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
  isMaster: false,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi(me: AuthUser | null, masterLogin = false) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/auth/me') return Promise.resolve(me ? json(me) : json({}, 401));
    if (url === '/auth/config') return Promise.resolve(json({ masterLogin, sso: true }));
    return Promise.resolve(json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('guarda de rota', () => {
  it('redireciona anônimo para o login', async () => {
    mockApi(null);
    renderAt('/schedule');
    expect(await screen.findByRole('button', { name: 'Entrar com Microsoft' })).toBeTruthy();
  });

  it('mostra o conteúdo para autenticado', async () => {
    mockApi(user('member'));
    renderAt('/schedule');
    expect(await screen.findByRole('heading', { name: 'Calendário' })).toBeTruthy();
  });

  it('mostra página 404', async () => {
    mockApi(user('member'));
    renderAt('/nada');
    expect(await screen.findByRole('heading', { name: 'Página não encontrada' })).toBeTruthy();
  });

  it('redireciona rota antiga em português para a nova', async () => {
    mockApi(user('member'));
    renderAt('/escala');
    expect(await screen.findByRole('heading', { name: 'Calendário' })).toBeTruthy();
  });

  it('mantém o guarda de papel após redirecionar rota antiga', async () => {
    mockApi(user('member'));
    renderAt('/equipe');
    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeTruthy();
  });
});

describe('RequireRole', () => {
  it('bloqueia membro em /members', async () => {
    mockApi(user('member'));
    renderAt('/members');
    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeTruthy();
  });

  it('permite gestor em /members', async () => {
    mockApi(user('manager'));
    renderAt('/members');
    expect(await screen.findByRole('heading', { name: 'Equipe' })).toBeTruthy();
  });
});

describe('menu por papel', () => {
  it('membro não vê itens de gestor', async () => {
    mockApi(user('member'));
    renderAt('/profile');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(nav.textContent).toContain('Minha escala');
    expect(nav.textContent).not.toContain('Equipe');
    expect(nav.textContent).not.toContain('Auditoria');
  });

  it('gestor vê itens de gestor', async () => {
    mockApi(user('manager'));
    renderAt('/profile');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    for (const label of ['Equipe', 'Feriados', 'Férias', 'Auditoria'])
      expect(nav.textContent).toContain(label);
    expect(nav.textContent).not.toContain('Férias coletivas');
  });

  it('perfil abre pela foto do usuário, não por item do menu', async () => {
    mockApi(user('member'));
    renderAt('/my-schedule');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(nav.textContent).not.toContain('Perfil');
    const link = screen.getByRole('link', { name: /Meu perfil|Membro/ });
    expect(link.getAttribute('href')).toBe('/profile');
  });
});

describe('convidado', () => {
  it('vai para o calendário e só vê o item Calendário no menu', async () => {
    mockApi(user('guest'));
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Calendário' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(nav.textContent).toContain('Calendário');
    for (const label of ['Minha escala', 'Trocas', 'Saldo', 'Equipe'])
      expect(nav.textContent).not.toContain(label);
    expect(screen.getByText('Convidado')).toBeTruthy();
  });

  it('é bloqueado nas páginas de membro e de gestor', async () => {
    for (const path of ['/my-schedule', '/swaps', '/balance', '/profile', '/members']) {
      mockApi(user('guest'));
      const { unmount } = renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeTruthy();
      unmount();
    }
  });
});

describe('login sem SSO', () => {
  it('esconde o botão Microsoft e abre o acesso master', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/auth/config' ? json({ masterLogin: true, sso: false }) : json({}, 401),
        ),
      ),
    );
    renderAt('/login');
    expect(await screen.findByText(/SSO\) não configurado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entrar com Microsoft' })).toBeNull();
    expect(screen.getByLabelText('Usuário')).toBeTruthy();
  });
});

describe('login master', () => {
  it('só mostra o formulário quando a master key está habilitada', async () => {
    mockApi(null, false);
    renderAt('/login');
    await screen.findByRole('button', { name: 'Entrar com Microsoft' });
    expect(screen.queryByText('Acesso master')).toBeNull();
  });

  it('envia usuário e senha para /auth/master-login', async () => {
    const fetchMock = mockApi(null, true);
    renderAt('/login');
    await userEvent.click(await screen.findByText('Acesso master'));
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'correct-horse-battery');
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    await userEvent.click(screen.getByRole('button', { name: 'Entrar como master' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    const call = fetchMock.mock.calls.find(([url]) => url === '/auth/master-login');
    const init = call?.[1] as unknown as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      username: 'root',
      password: 'correct-horse-battery',
    });
  });

  it('mostra erro para credenciais inválidas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/auth/me'
            ? json({}, 401)
            : url === '/auth/config'
              ? json({ masterLogin: true })
              : json({ error: 'invalid_credentials' }, 401),
        ),
      ),
    );
    renderAt('/login');
    await userEvent.click(await screen.findByText('Acesso master'));
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada-errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar como master' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Usuário ou senha inválidos');
  });
});

describe('login', () => {
  it('mostra mensagem quando o acesso foi negado', async () => {
    mockApi(null);
    renderAt('/login?error=denied');
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado');
  });

  it.each([
    ['inactive', 'está inativo'],
    ['identity_mismatch', 'não corresponde ao cadastro'],
    ['invalid_state', 'expirou ou é inválida'],
    ['idp_error', 'não foi concluído'],
    ['invalid_token', 'validar sua identidade'],
    ['qualquer_coisa', 'Não foi possível entrar'],
  ])('mostra mensagem específica para error=%s', async (reason, text) => {
    mockApi(null);
    renderAt(`/login?error=${reason}`);
    expect((await screen.findByRole('alert')).textContent).toContain(text);
  });

  it('não mostra alerta sem error', async () => {
    mockApi(null);
    renderAt('/login');
    await screen.findByRole('button', { name: 'Entrar com Microsoft' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('logout', () => {
  it('chama POST /auth/logout com X-Requested-With e volta ao login', async () => {
    const fetchMock = mockApi(user('member'));
    renderAt('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Entrar com Microsoft' })).toBeTruthy(),
    );
    const call = fetchMock.mock.calls.find(([url]) => url === '/auth/logout');
    const init = call?.[1] as unknown as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('plantao360');
  });
});
