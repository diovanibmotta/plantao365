import { loadRemote, registerRemotes } from '@module-federation/runtime';
import type { PluginWebModule } from '@diovanibmotta/plantao365-web-sdk';
import type { LoadedPlugin, PluginLoader } from './types';

/**
 * Registra os remotes do manifesto e carrega o módulo `./web` de cada plugin. Falha de um plugin
 * vira `error` só dele; os outros e o app seguem.
 */
export const loadFederatedPlugins: PluginLoader = async (plugins) => {
  const withWeb = plugins.filter((p) => p.web);
  registerRemotes(
    withWeb.map((p) => ({ name: p.web!.remote, entry: p.web!.entry, type: 'module' })),
  );
  return Promise.all(
    withWeb.map(async (p): Promise<LoadedPlugin> => {
      try {
        const mod = await loadRemote<{ default?: PluginWebModule }>(`${p.web!.remote}/web`);
        if (!mod?.default) throw new Error('o módulo ./web não tem export default');
        return { id: p.id, name: p.name, module: mod.default, error: null };
      } catch (err) {
        console.error(`Plugin ${p.id}: falha ao carregar o front`, err);
        return {
          id: p.id,
          name: p.name,
          module: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
};
