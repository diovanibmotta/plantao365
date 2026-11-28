import { loadRemote, registerRemotes } from '@module-federation/runtime';
import type { PluginWebModule } from '@diovanibmotta/plantao365-web-sdk';
import type { LoadedPlugin, PluginLoader } from './types';

/** `entry` já registrada por remote nesta página. */
const registered = new Map<string, string>();

/**
 * Registra os remotes do manifesto e carrega o módulo `./web` de cada plugin. Falha de um plugin
 * vira `error` só dele; os outros e o app seguem.
 */
export const loadFederatedPlugins: PluginLoader = async (plugins) => {
  const withWeb = plugins.filter((p) => p.web);
  for (const { web } of withWeb) {
    const { remote: name, entry } = web!;
    const previous = registered.get(name);
    // Sem `force` o runtime ignora o novo registro e segue com o módulo da versão anterior.
    registerRemotes([{ name, entry, type: 'module' }], {
      force: previous !== undefined && previous !== entry,
    });
    registered.set(name, entry);
  }
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
