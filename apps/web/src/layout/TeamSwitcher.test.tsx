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

describe('seletor de equipe', () => {
  it('lista as equipes e envia X-Team-Id da equipe escolhida', async () => {
    const calls: Array<{ url: string; team: string | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, team: (init?.headers as Record<string, string>)?.['X-Team-Id'] });
        if (url === '/auth/me') return Promise.resolve(json(me));
        if (url === '/api/teams') {
          return Promise.resolve(
            json([
              { id: 't1', name: 'Infra' },
              { id: 't2', name: 'Dados' },
            ]),
          );
        }
        return Promise.resolve(json([]));
      }),
    );
    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    const select = await screen.findByLabelText('Equipe');
    await userEvent.selectOptions(select, 't2');
    await waitFor(() =>
      expect(calls.some((c) => c.url !== '/api/teams' && c.team === 't2')).toBe(true),
    );
    expect(localStorage.getItem('p360_team')).toBe('t2');
  });
});
