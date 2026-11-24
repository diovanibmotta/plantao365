// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = {
  id: '1',
  email: 'a@b.c',
  name: 'Ana Souza',
  role: 'manager',
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
  isMaster: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('página Equipes', () => {
  it('cria equipe e o seletor do menu não oferece cadastro', async () => {
    const teams = [{ id: 't1', name: 'Infra' }];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/auth/me') return Promise.resolve(json(me));
        if (url === '/api/teams' && init?.method === 'POST') {
          const team = { id: 't2', name: 'Dados' };
          teams.push(team);
          return Promise.resolve(json(team, 201));
        }
        if (url === '/api/teams') return Promise.resolve(json(teams));
        return Promise.resolve(json([]));
      }),
    );
    render(
      <MemoryRouter initialEntries={['/teams']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Equipes' });
    expect(screen.queryByRole('button', { name: 'Nova' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Nova equipe' }));
    await userEvent.type(screen.getByLabelText('Nome da equipe'), 'Dados');
    await userEvent.type(screen.getByLabelText('URL do dashboard'), 'https://grafana.x/d/1');
    await userEvent.click(screen.getByRole('button', { name: 'Ícone 🚀' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('button', { name: 'Gerenciar Dados' })).toBeTruthy();
    const post = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(
      ([, init]) => init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      name: 'Dados',
      dashboardUrl: 'https://grafana.x/d/1',
      avatar: '🚀',
    });
    expect(await screen.findByRole('tab', { name: 'Membros', selected: true })).toBeTruthy();
  });

  it('vincula e desvincula membros da equipe', async () => {
    const teams = [{ id: 't1', name: 'Infra' }];
    const ana = { id: '1', name: 'Ana Souza', email: 'a@b.c' };
    const bia = { id: '2', name: 'Bia Lima', email: 'b@b.c' };
    let members = [ana];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/auth/me') return Promise.resolve(json(me));
        if (url === '/api/teams/t1/members/2' && init?.method === 'PUT') {
          members = [...members, bia];
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (url === '/api/teams/t1/members/1' && init?.method === 'DELETE') {
          members = members.filter((m) => m.id !== '1');
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (url === '/api/teams/t1/members') return Promise.resolve(json(members));
        if (url === '/api/users') return Promise.resolve(json([ana, bia]));
        if (url === '/api/teams') return Promise.resolve(json(teams));
        return Promise.resolve(json([]));
      }),
    );
    render(
      <MemoryRouter initialEntries={['/teams']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Gerenciar Infra' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Membros' }));
    await screen.findByRole('button', { name: 'Desvincular Ana Souza de Infra' });

    await userEvent.selectOptions(screen.getByLabelText('Adicionar membro a Infra'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Vincular a Infra' }));
    expect(
      await screen.findByRole('button', { name: 'Desvincular Bia Lima de Infra' }),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Desvincular Ana Souza de Infra' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Desvincular Ana Souza de Infra' })).toBeNull(),
    );
  });
});
