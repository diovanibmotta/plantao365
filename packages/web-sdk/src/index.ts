import { createElement, type ComponentType, type ReactNode } from 'react';

/*
 * SDK do front para plugins. O host (apps/web) registra a implementação real com
 * `registerWebSdk` antes de renderizar; o plugin importa daqui os mesmos componentes, cliente HTTP
 * e hooks das telas nativas, para seguir o padrão de telas e a identidade visual do app.
 * Host e plugins compartilham este módulo como singleton (Module Federation).
 */

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

// ---- superfície exposta pelo host ----

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export interface EmptyStateProps {
  children: ReactNode;
  action?: ReactNode;
}

export interface FilterBarProps {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  onClear: () => void;
  clearable: boolean;
  children?: ReactNode;
}

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  children?: ReactNode;
  busy?: boolean;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export interface FormPageProps {
  crumbs: Crumb[];
  title: string;
  description?: string;
  onSubmit: () => void;
  children: ReactNode;
}

export interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export interface FormActionsProps {
  onCancel: () => void;
  onDelete?: (() => void) | undefined;
  busy: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  deleteLabel?: string;
}

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
  PageHeader: ComponentType<PageHeaderProps>;
  EmptyState: ComponentType<EmptyStateProps>;
  FilterBar: ComponentType<FilterBarProps>;
  ConfirmDialog: ComponentType<ConfirmDialogProps>;
  FormPage: ComponentType<FormPageProps>;
  FormSection: ComponentType<FormSectionProps>;
  FormActions: ComponentType<FormActionsProps>;
  normalizeSearch(text: string): string;
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

const component =
  <P extends object>(pick: (s: WebSdkHost) => ComponentType<P>) =>
  (props: P) =>
    createElement(pick(h()), props);

export const PageHeader = component((s) => s.PageHeader);
export const EmptyState = component((s) => s.EmptyState);
export const FilterBar = component((s) => s.FilterBar);
export const ConfirmDialog = component((s) => s.ConfirmDialog);
export const FormPage = component((s) => s.FormPage);
export const FormSection = component((s) => s.FormSection);
export const FormActions = component((s) => s.FormActions);

export const normalizeSearch = (text: string) => h().normalizeSearch(text);

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
