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

export class NetworkError extends Error {
  constructor() {
    super('Não foi possível conectar ao servidor.');
    this.name = 'NetworkError';
  }
}

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'plantao360';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
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

export async function request<T = unknown>(
  path: string,
  { method = 'GET', body, signal }: RequestOptions = {},
): Promise<T> {
  const verb = method.toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (verb !== 'GET') headers[CSRF_HEADER] = CSRF_VALUE;
  const init: RequestInit = { method: verb, headers, credentials: 'same-origin' };
  if (signal) init.signal = signal;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError();
  }

  const data = await parseBody(res);
  if (res.ok) return data as T;
  if (res.status === 401) throw new UnauthorizedError(data);
  if (res.status === 403) throw new ForbiddenError(data);
  const message =
    typeof data === 'object' && data !== null && 'message' in data
      ? String((data as { message: unknown }).message)
      : `Erro ${res.status}`;
  throw new ApiError(res.status, message, data);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
