/** Ambiente descartável do E2E de navegador: valores de teste, só para a API local. */
export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;
/** Servidor Postgres onde o banco do E2E é recriado (apagado a cada execução). */
export const ADMIN_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const E2E_DATABASE = 'plantao365_e2e';
export const MASTER = { username: 'master-e2e', password: 'sk-e2e-somente-teste-local' };
export const INSTALL_TOKEN = 'e2e-install-token-'.padEnd(40, 'x');
/** Pasta de trabalho (ignorada pelo git): pacote assinado do plugin e sessão do navegador. */
export const WORK_DIR = '.local/e2e';
export const PLUGIN_ARCHIVE = `${WORK_DIR}/emergency-contacts.p365`;
export const SESSION_FILE = `${WORK_DIR}/session.json`;
export const PLUGIN_ID = 'emergency-contacts';
/** Commit fixo do plugin de referência: ao atualizar, revise os snapshots. */
export const PLUGIN_REPO = 'plantao365/plugin-emergency-contacts';
export const PLUGIN_SHA = '715ae5dac5e7b183311a4bca90a7e21a6aa70fa7';
