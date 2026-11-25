// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

interface TeamRow {
  id: string;
  name: string;
  dashboardUrl?: string | null;
  avatar?: string | null;
}

const infra: TeamRow = { id: 't1', name: 'Infra', dashboardUrl: 'https://grafana.x/d/1' };
const dados: TeamRow = { id: 't2', name: 'Dados' };
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

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function renderAt(path: string, teams: TeamRow[], extra: Handler = () => undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/auth/me') return Promise.resolve(json(me));
      const custom = extra(url, init);
      if (custom) return Promise.resolve(custom);
      if (url === '/api/teams' && (!init?.method || init.method === 'GET'))
        return Promise.resolve(json(teams));
      return Promise.resolve(json([]));
    }),
  );
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const calls = (method: string) =>
  (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls.filter(
    ([, init]) => init?.method === method,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('listagem de equipes', () => {
  it('mostra as equipes com Editar por linha e contagem', async () => {
    renderAt('/teams', [infra, dados]);
    const table = await screen.findByRole('table', { name: 'Equipes' });
    expect(within(table).getByText('Infra')).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'Editar Dados' }).getAttribute('href')).toBe(
      '/teams/t2',
    );
    expect(within(table).getByRole('link', { name: 'Membros de Infra' }).getAttribute('href')).toBe(
      '/teams/t1/members',
    );
    expect(screen.getByRole('link', { name: 'Nova equipe' }).getAttribute('href')).toBe(
      '/teams/new',
    );
    expect(screen.getByText('2 de 2 registros')).toBeTruthy();
  });

  it('busca sem acento e caixa, filtra por dashboard e limpa os filtros', async () => {
    renderAt('/teams', [infra, dados, { id: 't3', name: 'Operações' }]);
    await screen.findByRole('table', { name: 'Equipes' });

    await userEvent.type(screen.getByRole('searchbox'), 'OPERACOES');
    expect(screen.getByText('1 de 3 registros')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Editar Infra' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await userEvent.selectOptions(screen.getByLabelText('Dashboard'), 'with');
    expect(screen.getByText('1 de 3 registros')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Editar Infra' })).toBeTruthy();

    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('Nenhum registro encontrado para os filtros aplicados.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('3 de 3 registros')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });

  it('sem equipes mostra o estado vazio com o CTA e sem filtros', async () => {
    renderAt('/teams', []);
    await screen.findByText('Nenhuma equipe cadastrada. Crie a primeira equipe.');
    expect(screen.getAllByRole('link', { name: 'Nova equipe' })).toHaveLength(1);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});

describe('formulário de equipe', () => {
  it('cria equipe e volta à listagem', async () => {
    const teams = [infra];
    renderAt('/teams/new', teams, (url, init) => {
      if (url === '/api/teams' && init?.method === 'POST') {
        const created = { ...dados, ...JSON.parse(String(init.body)) } as TeamRow;
        teams.push(created);
        return json(created, 201);
      }
      return undefined;
    });
    await userEvent.type(await screen.findByLabelText('Nome da equipe'), 'Dados');
    await userEvent.type(screen.getByLabelText('URL do dashboard'), 'https://grafana.x/d/2');
    await userEvent.click(screen.getByRole('button', { name: 'Ícone 🚀' }));
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('table', { name: 'Equipes' })).toBeTruthy();
    expect(JSON.parse(String(calls('POST')[0]?.[1]?.body))).toEqual({
      name: 'Dados',
      dashboardUrl: 'https://grafana.x/d/2',
      avatar: '🚀',
    });
    expect(screen.getByRole('link', { name: 'Editar Dados' })).toBeTruthy();
  });

  it('valida nome obrigatório e URL do dashboard sem enviar', async () => {
    renderAt('/teams/new', [infra]);
    await userEvent.click(await screen.findByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Informe o nome da equipe.');

    await userEvent.type(screen.getByLabelText('Nome da equipe'), 'Dados');
    await userEvent.type(screen.getByLabelText('URL do dashboard'), 'grafana');
    expect(screen.getByRole('alert').textContent).toContain('URL válida');
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(calls('POST')).toHaveLength(0);
  });

  it('edita equipe existente e volta à listagem', async () => {
    renderAt('/teams/t1', [infra], (url, init) => {
      if (url === '/api/teams/t1' && init?.method === 'PATCH') {
        return json({ ...infra, ...JSON.parse(String(init.body)) });
      }
      return undefined;
    });
    const name = await screen.findByLabelText('Nome da equipe');
    expect((name as HTMLInputElement).value).toBe('Infra');
    await userEvent.clear(name);
    await userEvent.type(name, 'Infra Cloud');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('table', { name: 'Equipes' })).toBeTruthy();
    expect(JSON.parse(String(calls('PATCH')[0]?.[1]?.body))).toEqual({
      name: 'Infra Cloud',
      dashboardUrl: 'https://grafana.x/d/1',
      avatar: null,
    });
    expect(screen.getByRole('link', { name: 'Editar Infra Cloud' })).toBeTruthy();
  });

  it('exclui só após confirmar e o cancelamento não exclui', async () => {
    renderAt('/teams/t1', [infra, dados], (url, init) =>
      url === '/api/teams/t1' && init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : undefined,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog');
    expect(calls('DELETE')).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls('DELETE')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }),
    );
    expect(await screen.findByRole('table', { name: 'Equipes' })).toBeTruthy();
    expect(calls('DELETE')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Editar Infra' })).toBeNull();
  }, 15000);

  it('equipe inexistente mostra mensagem com volta à listagem', async () => {
    renderAt('/teams/nope', [infra]);
    expect((await screen.findByRole('alert')).textContent).toBe('Equipe não encontrada.');
    expect(screen.getByRole('link', { name: 'Voltar para a listagem' })).toBeTruthy();
  });

  it('Cancelar volta à listagem sem salvar', async () => {
    renderAt('/teams/t1', [infra]);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('table', { name: 'Equipes' })).toBeTruthy();
    expect(calls('PATCH')).toHaveLength(0);
  });
});

describe('membros da equipe', () => {
  it('abre a gestão de membros a partir do formulário da equipe', async () => {
    renderAt('/teams/t1', [infra], (url) =>
      url === '/api/teams/t1/members' ? json([ana]) : undefined,
    );
    await userEvent.click(await screen.findByRole('link', { name: 'Gerenciar membros' }));
    expect(await screen.findByRole('heading', { name: 'Membros de Infra' })).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Desvincular Ana Souza de Infra' }),
    ).toBeTruthy();
  });

  it('vincula e desvincula membros da equipe', async () => {
    let members = [ana];
    const puts: unknown[] = [];
    renderAt('/teams/t1/members', [infra], (url, init) => {
      if (url === '/api/teams/t1/members/2' && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        members = [...members, bia];
        return json(bia);
      }
      if (url === '/api/teams/t1/members/1' && init?.method === 'DELETE') {
        members = members.filter((m) => m.id !== '1');
        return new Response(null, { status: 204 });
      }
      if (url === '/api/teams/t1/members') return json(members);
      if (url === '/api/users') return json([ana, bia]);
      return undefined;
    });
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
    renderAt('/teams/t1/members', [infra], (url) => {
      if (url === '/api/teams/t1/members/2') {
        return json({
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
        });
      }
      if (url === '/api/teams/t1/members') return json([bia]);
      return undefined;
    });
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

  it('equipe inexistente na rota de membros mostra mensagem', async () => {
    renderAt('/teams/nope/members', [infra]);
    expect((await screen.findByRole('alert')).textContent).toBe('Equipe não encontrada.');
  });
});
