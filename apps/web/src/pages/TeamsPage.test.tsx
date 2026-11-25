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
    const ana = {
      id: '1',
      name: 'Ana Souza',
      email: 'a@b.c',
      active: true,
      role: 'manager',
      participatesInRotation: false,
    };
    const bia = {
      id: '2',
      name: 'Bia Lima',
      email: 'b@b.c',
      active: true,
      role: 'member',
      participatesInRotation: true,
    };
    let members = [ana];
    const puts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/auth/me') return Promise.resolve(json(me));
        if (url === '/api/teams/t1/members/2' && init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          members = [...members, bia];
          return Promise.resolve(json(bia));
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
    await userEvent.selectOptions(screen.getByLabelText('Papel do novo membro'), 'manager');
    await userEvent.selectOptions(screen.getByLabelText('Papel do novo membro'), 'member');
    await userEvent.click(screen.getByRole('button', { name: 'Vincular a Infra' }));
    expect(
      await screen.findByRole('button', { name: 'Desvincular Bia Lima de Infra' }),
    ).toBeTruthy();

    expect(puts).toEqual([{ role: 'member', participatesInRotation: true }]);
    expect((screen.getByLabelText('Papel de Ana Souza em Infra') as HTMLSelectElement).value).toBe(
      'manager',
    );
    expect(
      (screen.getByLabelText('Participa do rodízio: Ana Souza') as HTMLInputElement).checked,
    ).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Desvincular Ana Souza de Infra' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Desvincular Ana Souza de Infra' })).toBeNull(),
    );
  });

  it('abre o cartão do membro com contatos, preferências e exceções', async () => {
    const teams = [{ id: 't1', name: 'Infra' }];
    const bia = {
      id: '2',
      name: 'Bia Lima',
      email: 'b@b.c',
      active: true,
      role: 'member',
      participatesInRotation: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/auth/me') return Promise.resolve(json(me));
        if (url === '/api/teams/t1/members/2') {
          return Promise.resolve(
            json({
              ...bia,
              phone: '+55 11 99999-0000',
              preferences: { avoidWeekdays: [0, 6], maxConsecutiveShifts: 2 },
              unavailabilities: [
                {
                  id: 'u1',
                  kind: 'vacation',
                  startDate: '2099-01-10',
                  endDate: '2099-01-20',
                  note: 'Viagem',
                },
              ],
            }),
          );
        }
        if (url === '/api/teams/t1/members') return Promise.resolve(json([bia]));
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
    await userEvent.click(await screen.findByRole('button', { name: 'Perfil de Bia Lima' }));

    const card = await screen.findByRole('article', { name: 'Perfil de Bia Lima' });
    expect(card.textContent).toContain('Domingo, Sábado');
    expect(card.textContent).toContain('Férias: 10/01/2099 a 20/01/2099');
    expect(screen.getByRole('link', { name: '+55 11 99999-0000' }).getAttribute('href')).toBe(
      'tel:+5511999990000',
    );
    expect(screen.getByRole('link', { name: 'b@b.c' }).getAttribute('href')).toBe('mailto:b@b.c');

    await userEvent.click(screen.getByRole('button', { name: 'Perfil de Bia Lima' }));
    expect(screen.queryByRole('article', { name: 'Perfil de Bia Lima' })).toBeNull();
  });
});
