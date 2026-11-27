// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PluginsPage } from '../pages/PluginsPage';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { KeyForm } from './KeyForm';
import { PluginUploadForm } from './PluginUploadForm';
import { StorePluginForm } from './StorePluginForm';
import type { StoreItem, TrustedKey } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = (over: Partial<StoreItem> = {}): StoreItem => ({
  id: 'contacts',
  name: 'Contatos de emergência',
  description: 'Quem acionar.',
  repository: null,
  versions: [
    { version: '2.0.0', compatible: false },
    { version: '1.1.0', compatible: true },
    { version: '1.0.0', compatible: true },
  ],
  latest: '1.1.0',
  installedVersion: '1.0.0',
  updateAvailable: true,
  ...over,
});

const KEY: TrustedKey = {
  id: 'k1',
  name: 'Time de infra',
  publicKey: 'MCowBQYDK2VwAyEAchavepublicadeexemplo000000000000000=',
  createdAt: '2026-11-01T10:00:00.000Z',
};

function mockApi(handler: (url: string) => Response | undefined) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url) ?? json(init?.method === 'GET' ? { plugins: [] } : {})),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
    .map(([url, init]) => [url, init?.method, init?.body]);

const renderApp = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/plugins" element={<PluginsPage />} />
        <Route path="/plugins/upload" element={<PluginUploadForm />} />
        <Route path="/plugins/store/:id" element={<StorePluginForm />} />
        <Route path="/plugins/keys/new" element={<KeyForm />} />
        <Route path="/plugins/keys/:keyId" element={<KeyForm />} />
        <Route path="/plugins/:id" element={<p>formulário do plugin</p>} />
      </Routes>
      <ToastViewport />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('loja de plugins', () => {
  const catalog = (url: string) =>
    url === '/api/plugins/catalog' ? json({ plugins: [item()] }) : undefined;

  it('lista com a situação, busca sem acento e atualiza para a versão compatível', async () => {
    const fetchMock = mockApi(catalog);
    const user = userEvent.setup();
    renderApp('/plugins?tab=store');
    const table = await screen.findByRole('table', { name: 'Loja de plugins' });
    expect(table.textContent).toContain('Atualização disponível');
    await user.type(screen.getByPlaceholderText('Buscar por nome ou descrição'), 'emergencia');
    expect(within(table).getAllByRole('row')).toHaveLength(2);

    await user.click(screen.getByRole('link', { name: 'Abrir Contatos de emergência' }));
    const select = (await screen.findByLabelText('Versão')) as HTMLSelectElement;
    expect(select.value).toBe('1.1.0');
    await user.selectOptions(select, '1.0.0');
    expect(
      (screen.getByRole('button', { name: 'Já instalada' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.selectOptions(select, '1.1.0');
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByText('formulário do plugin')).toBeTruthy();
    expect(writes(fetchMock)).toEqual([
      ['/api/plugins/catalog/contacts/install', 'POST', JSON.stringify({ version: '1.1.0' })],
    ]);
  });

  it('loja fora do ar mostra o motivo; plugin inexistente volta para a loja', async () => {
    mockApi((url) =>
      url === '/api/plugins/catalog'
        ? json({ error: 'store_unavailable', message: 'Loja indisponível.' }, 502)
        : undefined,
    );
    renderApp('/plugins?tab=store');
    expect((await screen.findByRole('alert')).textContent).toBe('Loja indisponível.');
    cleanup();
    mockApi(catalog);
    renderApp('/plugins/store/nada');
    expect((await screen.findByRole('alert')).textContent).toBe('Plugin não encontrado na loja.');
  });
});

describe('instalar de arquivo', () => {
  it('exige os dois arquivos e envia em base64', async () => {
    const fetchMock = mockApi(() => undefined);
    const user = userEvent.setup();
    renderApp('/plugins/upload');
    await user.click(screen.getByRole('button', { name: 'Instalar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escolha o pacote e a assinatura.');
    await user.upload(screen.getByLabelText('Pacote (.p365)'), new File(['abc'], 'a.p365'));
    await user.upload(screen.getByLabelText('Assinatura (.sig)'), new File(['xy'], 'a.p365.sig'));
    await user.click(screen.getByRole('button', { name: 'Instalar' }));
    await waitFor(() =>
      expect(writes(fetchMock)).toEqual([
        ['/api/plugins', 'POST', JSON.stringify({ archive: 'YWJj', signature: 'eHk=' })],
      ]),
    );
  });
});

describe('chaves confiáveis', () => {
  const keys = (url: string) => (url === '/api/plugins/keys' ? json({ keys: [KEY] }) : undefined);

  it('lista, filtra e mostra o estado vazio com o CTA', async () => {
    mockApi(keys);
    const user = userEvent.setup();
    renderApp('/plugins?tab=keys');
    await screen.findByRole('table', { name: 'Chaves confiáveis' });
    await user.type(screen.getByPlaceholderText('Buscar por nome'), 'zzz');
    expect(screen.getByText('Nenhum registro encontrado para os filtros aplicados.')).toBeTruthy();
    cleanup();
    mockApi(() => json({ keys: [] }));
    renderApp('/plugins?tab=keys');
    expect(await screen.findByText(/^Nenhuma chave cadastrada\./)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Nova chave' })).toHaveLength(2);
  });

  it('cadastra, barrando chave repetida', async () => {
    const fetchMock = mockApi(keys);
    const user = userEvent.setup();
    renderApp('/plugins/keys/new');
    await user.type(await screen.findByLabelText('Nome'), 'Parceiro');
    const field = screen.getByLabelText('Chave pública');
    await user.type(field, KEY.publicKey);
    expect(screen.getByRole('alert').textContent).toBe('Esta chave já está cadastrada.');
    await user.clear(field);
    await user.type(field, 'novachave');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(writes(fetchMock)).toEqual([
        ['/api/plugins/keys', 'POST', JSON.stringify({ name: 'Parceiro', publicKey: 'novachave' })],
      ]),
    );
  });

  it('exclui só após confirmar; registro inexistente mostra mensagem', async () => {
    const fetchMock = mockApi(keys);
    const user = userEvent.setup();
    renderApp('/plugins/keys/k1');
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    expect(writes(fetchMock)).toEqual([]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(writes(fetchMock)).toEqual([['/api/plugins/keys/k1', 'DELETE', undefined]]),
    );
    cleanup();
    renderApp('/plugins/keys/nada');
    expect((await screen.findByRole('alert')).textContent).toBe('Chave não encontrada.');
  });
});
