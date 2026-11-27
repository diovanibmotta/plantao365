export const PLUGINS_PATH = '/plugins';
export const pluginAdminPath = (id: string) => `${PLUGINS_PATH}/${id}`;
/** Telas dos próprios plugins (rotas declaradas no `./web` de cada um). */
export const pluginPagePath = (id: string, path = '') => `/ext/${id}${path ? `/${path}` : ''}`;
