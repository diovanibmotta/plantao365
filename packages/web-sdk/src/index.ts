import type { ComponentType } from 'react';

/*
 * SDK do front para plugins e design system compartilhado do Plantão365.
 * - Tokens (`tokens.css`) e componentes "dumb" (só props → visual, sem estado de app nem HTTP)
 *   moram aqui e são usados pelo próprio app e pelos plugins: mesma identidade visual.
 * - Serviços com estado do app (cliente HTTP, toasts, equipe e papel) vêm do host, que os registra
 *   com `registerWebSdk` antes de renderizar.
 * Host e plugins compartilham este módulo como singleton (Module Federation).
 */

export { ConfirmDialog } from './ui/ConfirmDialog.js';
export { EmptyState } from './ui/EmptyState.js';
export { FilterBar, normalizeSearch } from './ui/FilterBar.js';
export { Breadcrumb, FormActions, FormPage, FormSection, type Crumb } from './ui/FormPage.js';
export { InfoDialog } from './ui/InfoDialog.js';
export { PageHeader } from './ui/PageHeader.js';
export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Pagination,
  usePagination,
} from './ui/Pagination.js';
export { PluginPage } from './ui/PluginPage.js';

export type Role = 'manager' | 'member' | 'guest';

// ---- contrato de contribuições do plugin ----

/** Rota servida em `/plugins/<id>/<path>` (path relativo: '' é a raiz do plugin). */
export interface PluginRoute {
  path: string;
  component: ComponentType;
  /** Papel mínimo; sem valor = membro ou acima. */
  role?: Role;
}

export type PluginNavGroup = 'schedule' | 'admin';

export interface PluginNavItem {
  label: string;
  /** Relativo à raiz do plugin; padrão ''. */
  path?: string;
  /**
   * Ícone como dados `d` de paths SVG em viewBox 24x24, desenhados com traço (`stroke`), sem cor
   * própria: o host aplica a moldura e a cor dos ícones nativos.
   */
  icon?: string[];
  group: PluginNavGroup;
  role?: Role;
}

/** Pontos nomeados das telas nativas onde um plugin pode inserir conteúdo. */
export const SLOT_NAMES = ['schedule.toolbar', 'my-schedule.aside', 'profile.sections'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export interface PluginWebModule {
  routes?: PluginRoute[];
  nav?: PluginNavItem[];
  slots?: Partial<Record<SlotName, ComponentType>>;
}

/** Identidade: só dá tipo ao `export default` do módulo `./web` do plugin. */
export const definePluginWeb = (module: PluginWebModule): PluginWebModule => module;

// ---- serviços com estado, registrados pelo host ----

export interface ToastOptions {
  successMessage?: string;
  silentSuccess?: boolean;
  silentError?: boolean;
}

/** Cliente HTTP do app (CSRF, equipe ativa, toasts e confirmação de impacto já tratados). */
export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: ToastOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, opts?: ToastOptions): Promise<T>;
  put<T>(path: string, body?: unknown, opts?: ToastOptions): Promise<T>;
  delete<T>(path: string, opts?: ToastOptions): Promise<T>;
}

export interface ActiveTeam {
  id: string;
  name: string;
}

export interface WebSdkHost {
  api: ApiClient;
  toast: {
    success(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
  useActiveTeam(): ActiveTeam | null;
  useRole(): Role | null;
}

let host: WebSdkHost | undefined;

/** Chamado uma vez pelo host antes de renderizar. */
export function registerWebSdk(impl: WebSdkHost): void {
  host = impl;
}

function h(): WebSdkHost {
  if (!host) throw new Error('web-sdk: host do Plantão365 não registrado (registerWebSdk).');
  return host;
}

/**
 * Prefixo das rotas de API do plugin: `pluginApi('emergency-contacts')('/contacts')` →
 * `/api/extensions/emergency-contacts/contacts`.
 */
export const pluginApi = (id: string) => (path: string) => `/api/extensions/${id}${path}`;

export const api: ApiClient = {
  get: (path, signal) => h().api.get(path, signal),
  post: (path, body, opts) => h().api.post(path, body, opts),
  patch: (path, body, opts) => h().api.patch(path, body, opts),
  put: (path, body, opts) => h().api.put(path, body, opts),
  delete: (path, opts) => h().api.delete(path, opts),
};

export const toast = {
  success: (message: string) => h().toast.success(message),
  warning: (message: string) => h().toast.warning(message),
  error: (message: string) => h().toast.error(message),
};

export const useActiveTeam = () => h().useActiveTeam();
export const useRole = () => h().useRole();
