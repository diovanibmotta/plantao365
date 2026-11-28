import type { PluginWebModule } from '@plantao365/web-sdk';

/** Item de `GET /api/plugins/manifest`: plugins ativos na API. */
export interface PluginManifestEntry {
  id: string;
  name: string;
  version: string;
  /** URL do remoteEntry (mesma origem) e nome do container Module Federation. */
  web: { entry: string; remote: string } | null;
}

export interface LoadedPlugin {
  id: string;
  name: string;
  /** Nulo quando o módulo web falhou ao carregar (`error` explica). */
  module: PluginWebModule | null;
  error: string | null;
}

export type PluginLoader = (plugins: PluginManifestEntry[]) => Promise<LoadedPlugin[]>;
