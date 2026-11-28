import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { LoadedPlugin, PluginLoader, PluginManifestEntry } from './types';

interface PluginState {
  plugins: LoadedPlugin[];
  loading: boolean;
}

interface PluginContextValue extends PluginState {
  /** Relê o manifesto; chamar após instalar, remover, habilitar ou desabilitar um plugin. */
  reload: () => void;
}

const PluginCtx = createContext<PluginContextValue>({
  plugins: [],
  loading: false,
  reload: () => undefined,
});

/**
 * Carrega os plugins ativos (`/api/plugins/manifest`) e seus módulos web, na abertura do app e a
 * cada `reload`. Sem plugins ou com erro no manifesto, o app funciona igual (lista vazia na
 * abertura; no `reload`, mantém a lista anterior).
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
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);

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
        return null;
      })
      .then((plugins) => {
        if (alive) setState((s) => ({ plugins: plugins ?? s.plugins, loading: false }));
      });
    return () => {
      alive = false;
    };
  }, [loader, revision]);

  return <PluginCtx.Provider value={{ ...state, reload }}>{children}</PluginCtx.Provider>;
}

export const usePlugins = (): PluginContextValue => useContext(PluginCtx);
