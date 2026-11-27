import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { LoadedPlugin, PluginLoader, PluginManifestEntry } from './types';

interface PluginState {
  plugins: LoadedPlugin[];
  loading: boolean;
}

const PluginCtx = createContext<PluginState>({ plugins: [], loading: false });

/**
 * Carrega, uma vez por sessão, os plugins ativos (`/api/plugins/manifest`) e seus módulos web.
 * Sem plugins ou com erro no manifesto, o app funciona igual (lista vazia).
 */
export function PluginProvider({
  loader,
  children,
}: {
  /** Injeção para testes; em produção, Module Federation (carregado sob demanda). */
  loader?: PluginLoader;
  children: ReactNode;
}) {
  const [state, setState] = useState<PluginState>({ plugins: [], loading: true });

  useEffect(() => {
    let alive = true;
    api
      .get<{ plugins: PluginManifestEntry[] }>('/api/plugins/manifest')
      .then(async ({ plugins }) => {
        const web = plugins.filter((p) => p.web);
        if (web.length === 0) return [];
        const load = loader ?? (await import('./loader')).loadFederatedPlugins;
        return load(web);
      })
      .catch((err: unknown) => {
        console.error('Falha ao carregar o manifesto de plugins', err);
        return [];
      })
      .then((plugins) => {
        if (alive) setState({ plugins, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [loader]);

  return <PluginCtx.Provider value={state}>{children}</PluginCtx.Provider>;
}

export const usePlugins = (): PluginState => useContext(PluginCtx);
