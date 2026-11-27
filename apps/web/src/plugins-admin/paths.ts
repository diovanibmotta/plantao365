export const PLUGINS_PATH = '/plugins';
export const pluginAdminPath = (id: string) => `${PLUGINS_PATH}/${id}`;
/** Telas dos próprios plugins (rotas declaradas no `./web` de cada um). */
export const pluginPagePath = (id: string, path = '') => `/ext/${id}${path ? `/${path}` : ''}`;

export type PluginsTab = 'installed' | 'store' | 'keys';
export const pluginsTabPath = (tab: PluginsTab) =>
  tab === 'installed' ? PLUGINS_PATH : `${PLUGINS_PATH}?tab=${tab}`;
export const PLUGIN_UPLOAD_PATH = `${PLUGINS_PATH}/upload`;
export const storePluginPath = (id: string) => `${PLUGINS_PATH}/store/${id}`;
export const NEW_KEY_PATH = `${PLUGINS_PATH}/keys/new`;
export const keyPath = (id: string) => `${PLUGINS_PATH}/keys/${id}`;
