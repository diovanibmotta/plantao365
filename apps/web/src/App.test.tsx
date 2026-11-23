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
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi(me: AuthUser | null) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(url === '/auth/me' ? (me ? json(me) : json({}, 401)) : json({ ok: true })),
  );
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
    renderAt('/escala');
    expect(await screen.findByRole('button', { name: 'Entrar com Microsoft' })).toBeTruthy();
  });

  it('mostra o conteúdo para autenticado', async () => {
    mockApi(user('member'));
    renderAt('/escala');
    expect(await screen.findByRole('heading', { name: 'Escala' })).toBeTruthy();
  });

  it('mostra página 404', async () => {
    mockApi(user('member'));
    renderAt('/nada');
    expect(await screen.findByRole('heading', { name: 'Página não encontrada' })).toBeTruthy();
  });
});

describe('RequireRole', () => {
  it('bloqueia membro em /equipe', async () => {
    mockApi(user('member'));
    renderAt('/equipe');
    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeTruthy();
  });

  it('permite gestor em /equipe', async () => {
    mockApi(user('manager'));
    renderAt('/equipe');
    expect(await screen.findByRole('heading', { name: 'Equipe' })).toBeTruthy();
  });
});

describe('menu por papel', () => {
  it('membro não vê itens de gestor', async () => {
    mockApi(user('member'));
    renderAt('/perfil');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(nav.textContent).toContain('Minha escala');
    expect(nav.textContent).not.toContain('Equipe');
    expect(nav.textContent).not.toContain('Auditoria');
  });

  it('gestor vê itens de gestor', async () => {
    mockApi(user('manager'));
    renderAt('/perfil');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    for (const label of ['Equipe', 'Feriados', 'Auditoria'])
      expect(nav.textContent).toContain(label);
  });
});

describe('login', () => {
  it('mostra mensagem quando o acesso foi negado', async () => {
    mockApi(null);
    renderAt('/login?error=denied');
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado');
  });

  it.each([
    ['not_registered', 'não está cadastrado'],
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
    renderAt('/perfil');
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
