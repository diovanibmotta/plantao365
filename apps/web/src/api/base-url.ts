/**
 * Origem da API definida em build (`VITE_API_BASE_URL`), p.ex. `https://api.suaempresa.com`.
 * Vazia (padrão): o front chama `/api` e `/auth` por caminho relativo, no mesmo domínio.
 */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

/** Resolve um caminho da API (`/api/...`, `/auth/...`) contra a origem configurada. */
export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path}`;
}

/** Com API em outra origem, o navegador só envia o cookie de sessão com `include`. */
export function apiCredentials(): RequestCredentials {
  return apiBaseUrl() ? 'include' : 'same-origin';
}
