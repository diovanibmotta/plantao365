// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth/AuthContext';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { PluginForm } from './PluginForm';
import { PluginsList } from './PluginsList';
import type { PluginSummary } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const plugin = (over: Partial<PluginSummary> = {}): PluginSummary => ({
  id: 'contacts',
  name: 'Contatos de emergência',
  version: '1.2.0',
  description: 'Quem acionar em incidente.',
  status: 'enabled',
  error: null,
  settings: { phone: '0800', retries: 2 },
  settingsSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', title: 'Telefone', maxLength: 20 },
      retries: { type: 'integer', title: 'Tentativas', minimum: 1, maximum: 5 },
      notify: { type: 'boolean', title: 'Avisar gestores' },
    },
    required: ['phone'],
  },
  active: true,
  installedAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

const BROKEN = plugin({
  id: 'broken',
  name: 'Relatórios',
  status: 'failed',
  error: 'quebrado',
  settingsSchema: null,
  settings: {},
});

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockApi(handler: Handler, isMaster = true) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/auth/me') {
      return Promise.resolve(
        json({ id: 'u1', email: 'a@b.c', name: 'Ana', role: 'manager', isMaster }),
      );
    }
    return Promise.resolve(handler(url, init) ?? json({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') !== 'GET')
    .map((c) => [c[0], (c[1] as RequestInit).method, (c[1] as RequestInit).body] as const);

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/plugins" element={<PluginsList />} />
          <Route path="/plugins/:id" element={<PluginForm />} />
        </Routes>
        <ToastViewport />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('listagem de plugins', () => {
  it('mostra versão e situação; busca sem acento e filtra por situação', async () => {
    mockApi(() => json({ plugins: [plugin(), BROKEN] }));
    const user = userEvent.setup();
    renderApp('/plugins');
    const table = await screen.findByRole('table', { name: 'Plugins' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('Contatos de emergência');
    expect(rows[0]!.textContent).toContain('1.2.0');
    expect(rows[0]!.textContent).toContain('Habilitado');
    expect(rows[1]!.textContent).toContain('Com falha');
    expect(rows[1]!.textContent).toContain('quebrado');

    await user.type(screen.getByPlaceholderText('Buscar por nome ou id'), 'relatorios');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    await user.selectOptions(screen.getByLabelText('Situação'), 'disabled');
    expect(screen.getByText('Nenhum registro encontrado para os filtros aplicados.')).toBeTruthy();
  });

  it('sem plugins mostra o estado vazio, sem barra de filtro', async () => {
    mockApi(() => json({ plugins: [] }));
    renderApp('/plugins');
    expect(await screen.findByText(/Nenhum plugin instalado/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Buscar por nome ou id')).toBeNull();
  });
});

describe('formulário de plugin', () => {
  it('gera os campos do schema, salva configuração e desabilita', async () => {
    const fetchMock = mockApi((url) =>
      url === '/api/plugins/contacts' ? json({ plugin: plugin() }) : undefined,
    );
    const user = userEvent.setup();
    renderApp('/plugins/contacts');
    const phone = await screen.findByLabelText('Telefone');
    expect((phone as HTMLInputElement).value).toBe('0800');
    expect((screen.getByLabelText('Tentativas') as HTMLInputElement).value).toBe('2');

    await user.clear(phone);
    await user.type(phone, '190');
    await user.click(screen.getByLabelText('Avisar gestores'));
    await user.click(screen.getByLabelText('Habilitado'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByLabelText('Telefone')).toBeNull());
    expect(writes(fetchMock)).toEqual([
      [
        '/api/plugins/contacts/settings',
        'PUT',
        JSON.stringify({ settings: { phone: '190', retries: 2, notify: true } }),
      ],
      ['/api/plugins/contacts/disable', 'POST', undefined],
    ]);
  });

  it('valida no formulário antes de enviar', async () => {
    const fetchMock = mockApi((url) =>
      url === '/api/plugins/contacts' ? json({ plugin: plugin() }) : undefined,
    );
    const user = userEvent.setup();
    renderApp('/plugins/contacts');
    await user.clear(await screen.findByLabelText('Telefone'));
    await user.clear(screen.getByLabelText('Tentativas'));
    await user.type(screen.getByLabelText('Tentativas'), '9');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['Obrigatório.', 'Máximo 5.']);
    expect(writes(fetchMock)).toEqual([]);
  });

  it('remove só após confirmar, com opção de apagar os dados', async () => {
    const fetchMock = mockApi((url) =>
      url === '/api/plugins/broken' ? json({ plugin: BROKEN }) : undefined,
    );
    const user = userEvent.setup();
    renderApp('/plugins/broken');
    expect(await screen.findByText('Este plugin não tem configuração.')).toBeTruthy();
    expect(screen.getByText('quebrado')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remover' }));
    const dialog = screen.getByRole('dialog');
    expect(writes(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByLabelText(/Apagar também os dados/));
    await user.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(writes(fetchMock)).toEqual([['/api/plugins/broken?purge=true', 'DELETE', undefined]]),
    );
  });

  it('gestor sem master key vê em modo leitura', async () => {
    mockApi(
      (url) => (url === '/api/plugins/contacts' ? json({ plugin: plugin() }) : undefined),
      false,
    );
    renderApp('/plugins/contacts');
    expect(await screen.findByText(/modo leitura/)).toBeTruthy();
    // desabilitado pelo <fieldset disabled>
    expect(screen.getByLabelText('Telefone').matches(':disabled')).toBe(true);
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull();
  });

  it('plugin inexistente mostra mensagem e volta para a listagem', async () => {
    mockApi((url) =>
      url === '/api/plugins/nope'
        ? json({ error: 'plugin_not_found', message: 'Plugin não encontrado.' }, 404)
        : json({ plugins: [] }),
    );
    const user = userEvent.setup();
    renderApp('/plugins/nope');
    expect((await screen.findByRole('alert')).textContent).toBe('Plugin não encontrado.');
    await user.click(screen.getByRole('button', { name: 'Voltar para a listagem' }));
    expect(await screen.findByText(/Nenhum plugin instalado/)).toBeTruthy();
  });
});
