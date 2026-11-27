// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PageHeader, definePluginWeb } from '@diovanibmotta/plantao365-web-sdk';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { PluginProvider } from './PluginContext';
import { Slot } from './Slot';
import { registerPluginSdk } from './sdk-host';
import type { LoadedPlugin, PluginLoader } from './types';

const demo = definePluginWeb({
  routes: [
    {
      path: '',
      component: () => <PageHeader title="Contatos de emergência" description="Quem acionar" />,
    },
    { path: 'admin', role: 'manager', component: () => <p>Configuração dos contatos</p> },
  ],
  nav: [{ label: 'Contatos', group: 'schedule', icon: ['M3 12h18'] }],
  slots: { 'profile.sections': () => <p>Seção do plugin</p> },
});

const loaded = (over: Partial<LoadedPlugin> = {}): LoadedPlugin => ({
  id: 'demo',
  name: 'Demo',
  module: demo,
  error: null,
  ...over,
});

let plugins: LoadedPlugin[] = [];
vi.mock('./loader', () => ({ loadFederatedPlugins: () => Promise.resolve(plugins) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const user = (role: 'manager' | 'member') => ({
  id: '1',
  email: 'a@b.c',
  name: 'Ana Souza',
  role,
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
  isMaster: false,
});

const manifest = {
  plugins: [
    {
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      web: { entry: '/plugins-assets/demo/1.0.0/web/remoteEntry.js', remote: 'plugin_demo' },
    },
  ],
};

function stubApi(role: 'manager' | 'member', manifestStatus = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/auth/me') return Promise.resolve(json(user(role)));
      if (url === '/api/teams') return Promise.resolve(json([{ id: 't1', name: 'Infra', role }]));
      if (url === '/api/plugins/manifest') return Promise.resolve(json(manifest, manifestStatus));
      return Promise.resolve(json({}));
    }),
  );
}

const renderApp = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

beforeAll(() => registerPluginSdk());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  plugins = [];
});

describe('kernel de plugins no front', () => {
  it('mostra o item de menu e a tela do plugin com os componentes nativos do web-sdk', async () => {
    plugins = [loaded()];
    stubApi('member');
    renderApp('/plugins/demo');
    expect(await screen.findByRole('heading', { name: 'Contatos de emergência' })).toBeTruthy();
    expect(screen.getByText('Quem acionar').closest('.ui-header')).not.toBeNull();
    const link = screen.getByRole('link', { name: /Contatos/ });
    expect(link.getAttribute('href')).toBe('/plugins/demo');
    expect(link.querySelector('svg path')?.getAttribute('d')).toBe('M3 12h18');
  });

  it('respeita o papel da rota do plugin', async () => {
    plugins = [loaded()];
    stubApi('member');
    renderApp('/plugins/demo/admin');
    expect(await screen.findByText('Acesso restrito')).toBeTruthy();
    expect(screen.queryByText('Configuração dos contatos')).toBeNull();
  });

  it('gestor acessa a rota restrita', async () => {
    plugins = [loaded()];
    stubApi('manager');
    renderApp('/plugins/demo/admin');
    expect(await screen.findByText('Configuração dos contatos')).toBeTruthy();
  });

  it('plugin inexistente é página não encontrada; front que falhou mostra aviso', async () => {
    plugins = [loaded({ module: null, error: 'falhou' })];
    stubApi('member');
    renderApp('/plugins/nope');
    expect(await screen.findByText('Página não encontrada')).toBeTruthy();
    cleanup();
    renderApp('/plugins/demo');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar a extensão Demo.',
    );
  });

  it('sem manifesto (erro na API) o app segue sem itens de plugin', async () => {
    plugins = [loaded()];
    stubApi('member', 500);
    renderApp('/plugins/demo');
    expect(await screen.findByText('Página não encontrada')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Contatos/ })).toBeNull();
  });
});

describe('Slot', () => {
  it('renderiza o conteúdo dos plugins e isola o que quebra', async () => {
    stubApi('member');
    const Broken = () => {
      throw new Error('boom');
    };
    const loader: PluginLoader = () =>
      Promise.resolve([
        loaded({
          id: 'broken',
          name: 'Quebrado',
          module: { slots: { 'profile.sections': Broken } },
        }),
        loaded(),
      ]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <PluginProvider loader={loader}>
        <Slot name="profile.sections" />
        <Slot name="schedule.toolbar" />
      </PluginProvider>,
    );
    expect(await screen.findByText('Seção do plugin')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'A extensão Quebrado não pôde ser exibida.',
    );
    expect(document.querySelectorAll('[data-slot="schedule.toolbar"]')).toHaveLength(0);
  });
});
