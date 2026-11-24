// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('button', { name: 'Editar Dados' })).toBeTruthy();
  });
});
