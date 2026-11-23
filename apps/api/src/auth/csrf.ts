import { createMiddleware } from 'hono/factory';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'plantao360';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfOptions {
  allowedOrigins: string[];
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Contrato com o front: toda requisição POST/PUT/PATCH/DELETE deve enviar o header
 * `X-Requested-With: plantao360`; Origin (ou Referer), quando presente, deve estar em allowedOrigins.
 * Caso contrário responde 403 `{ error: 'csrf' }`. GET/HEAD/OPTIONS não são verificados.
 */
export const csrfProtection = ({ allowedOrigins }: CsrfOptions) => {
  const allowed = new Set(allowedOrigins);
  return createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) return c.json({ error: 'csrf' }, 403);
    const source = c.req.header('origin') ?? c.req.header('referer');
    if (source !== undefined) {
      const origin = originOf(source);
      if (origin === null || !allowed.has(origin)) return c.json({ error: 'csrf' }, 403);
    }
    await next();
  });
};
