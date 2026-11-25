import { toast } from '../toast/toast-store';
import { apiCredentials, apiUrl } from './base-url';
import { requestImpactConfirmation } from './impact-confirm-store';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(body?: unknown) {
    super(401, 'Sessão expirada ou não autenticada.', body);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(body?: unknown) {
    super(403, 'Você não tem permissão para esta ação.', body);
    this.name = 'ForbiddenError';
  }
}

/** O usuário respondeu "Não" ao aviso de impacto em escala publicada; nada foi salvo. */
export class ImpactCancelledError extends Error {
  constructor() {
    super('Operação cancelada.');
    this.name = 'ImpactCancelledError';
  }
}

export const IMPACT_CONFIRMATION_ERROR = 'schedule_impact_confirmation_required';
const IMPACT_CONFIRM_PARAM = 'confirmImpact=true';

export class NetworkError extends Error {
  constructor() {
    super('Não foi possível conectar ao servidor.');
    this.name = 'NetworkError';
  }
}

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'plantao360';

let activeTeamId: string | null = null;

/** Equipe ativa: enviada em `X-Team-Id` em toda chamada à API. */
export function setActiveTeamId(id: string | null): void {
  activeTeamId = id;
}

export const TEAM_HEADER = 'X-Team-Id';

let unauthorizedHandler: (() => void) | null = null;

/** Registra o callback chamado em toda resposta 401 (sessão expirada); retorna o desregistro. */
export function setUnauthorizedHandler(handler: (() => void) | null): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

/** Controle do interceptor de toasts (aplicado só a POST/PUT/PATCH/DELETE). */
export interface ToastOptions {
  /** Texto do toast de sucesso; sobrepõe `message`/`notice` do corpo e o padrão do verbo. */
  successMessage?: string;
  /** Traduz o erro para o texto do toast; padrão: `message` do corpo ou texto por status. */
  errorMessage?: (err: ApiError) => string;
  /** Não exibe toast de sucesso. */
  silentSuccess?: boolean;
  /** Não exibe toast de erro (a tela trata o erro, ex.: fluxo de confirmação). */
  silentError?: boolean | ((err: ApiError) => boolean);
}

export interface RequestOptions extends ToastOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

const DEFAULT_SUCCESS: Record<string, string> = {
  POST: 'Operação realizada com sucesso.',
  PUT: 'Alterações salvas com sucesso.',
  PATCH: 'Alterações salvas com sucesso.',
  DELETE: 'Excluído com sucesso.',
};

function statusMessage(status: number): string {
  if (status === 400 || status === 422) return 'Dados inválidos. Revise as informações.';
  if (status === 404) return 'Registro não encontrado. Atualize a página.';
  if (status === 409) return 'Conflito com um registro existente.';
  if (status >= 500) return 'Erro interno do servidor. Tente novamente.';
  return `Erro ${status}`;
}

/** Texto de erro exibido ao usuário: `message` do corpo, senão mensagem por status. */
export function describeApiError(err: ApiError): string {
  if (err.message && !/^Erro \d+$/.test(err.message)) return err.message;
  return statusMessage(err.status);
}

function bodyString(body: unknown, key: 'message' | 'notice'): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Avisos de uma mutação: `warnings[].message` e, pela regra core, `scheduleImpact.message` (a
 * alteração atinge plantões de escala publicada; o gestor também é avisado por e-mail).
 */
function warningMessages(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const { warnings, scheduleImpact } = body as { warnings?: unknown; scheduleImpact?: unknown };
  const texts = Array.isArray(warnings)
    ? warnings.flatMap((w) =>
        typeof w === 'object' &&
        w !== null &&
        typeof (w as { message?: unknown }).message === 'string'
          ? [(w as { message: string }).message]
          : [],
      )
    : [];
  const impact = bodyString(scheduleImpact, 'message');
  return impact ? [...texts, impact] : texts;
}

function notifySuccess(verb: string, data: unknown, opts: ToastOptions): void {
  if (!opts.silentSuccess) {
    toast.success(
      opts.successMessage ??
        bodyString(data, 'message') ??
        bodyString(data, 'notice') ??
        DEFAULT_SUCCESS[verb] ??
        'Operação realizada com sucesso.',
    );
  }
  for (const w of warningMessages(data)) toast.warning(w);
}

function notifyError(err: unknown, opts: ToastOptions): void {
  if (err instanceof UnauthorizedError) return;
  if (err instanceof NetworkError) {
    if (opts.silentError !== true) toast.error(err.message);
  } else if (err instanceof ApiError) {
    const { silentError } = opts;
    if (silentError === true || (typeof silentError === 'function' && silentError(err))) return;
    toast.error((opts.errorMessage ?? describeApiError)(err));
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Mutação que atinge escala publicada volta 409: pergunta ao usuário (modal Sim/Não) e, se
 * confirmar, repete a chamada com `confirmImpact=true`; se não, nada é salvo.
 */
async function sendConfirmed<T>(path: string, options: RequestOptions): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (err) {
    const body = err instanceof ApiError && err.status === 409 ? err.body : undefined;
    if (typeof body !== 'object' || body === null) throw err;
    const { error, message, scheduleImpact } = body as {
      error?: unknown;
      message?: unknown;
      scheduleImpact?: { dates?: unknown };
    };
    if (error !== IMPACT_CONFIRMATION_ERROR) throw err;
    const dates = Array.isArray(scheduleImpact?.dates) ? scheduleImpact.dates.map(String) : [];
    const confirmed = await requestImpactConfirmation({ message: String(message ?? ''), dates });
    if (!confirmed) throw new ImpactCancelledError();
    return send<T>(`${path}${path.includes('?') ? '&' : '?'}${IMPACT_CONFIRM_PARAM}`, options);
  }
}

/** Executa a chamada e, em mutações (CUD), notifica sucesso/aviso/erro via toast. */
export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const verb = (options.method ?? 'GET').toUpperCase();
  if (verb === 'GET') return send<T>(path, options);
  try {
    const data = await sendConfirmed<T>(path, options);
    notifySuccess(verb, data, options);
    return data;
  } catch (err) {
    notifyError(err, options);
    throw err;
  }
}

async function send<T>(path: string, { method = 'GET', body, signal }: RequestOptions): Promise<T> {
  const verb = method.toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (verb !== 'GET') headers[CSRF_HEADER] = CSRF_VALUE;
  if (activeTeamId) headers[TEAM_HEADER] = activeTeamId;
  const init: RequestInit = { method: verb, headers, credentials: apiCredentials() };
  if (signal) init.signal = signal;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError();
  }

  const data = await parseBody(res);
  if (res.ok) return data as T;
  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new UnauthorizedError(data);
  }
  if (res.status === 403) throw new ForbiddenError(data);
  const message =
    typeof data === 'object' && data !== null && 'message' in data
      ? String((data as { message: unknown }).message)
      : `Erro ${res.status}`;
  throw new ApiError(res.status, message, data);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown, opts?: ToastOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: ToastOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: ToastOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: ToastOptions) => request<T>(path, { ...opts, method: 'DELETE' }),
};
