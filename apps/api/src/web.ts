import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono, MiddlewareHandler } from 'hono';

/** Caminhos que pertencem à API: nunca caem no fallback da SPA. */
const API_PREFIXES = ['/api', '/auth', '/health', '/plugins-assets'];

const isApiPath = (path: string) =>
  API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
};

/**
 * Serve o build do front (`apps/web/dist`) a partir da própria API (imagem única).
 * Arquivos em `/assets/` têm hash no nome (cache longo); o restante não é cacheado.
 * Rotas desconhecidas devolvem `index.html` (React Router), exceto `/api`, `/auth` e `/health`.
 * Deve ser montado depois de todas as rotas da API.
 */
export function mountWeb(app: Hono, dir: string): void {
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`WEB_DIST_DIR inválido: index.html não encontrado em ${dir}`);
  }
  const cacheControl: MiddlewareHandler = async (c, next) => {
    await next();
    if (c.res.status !== 200 && c.res.status !== 206) return;
    const immutable = c.req.path.startsWith('/assets/');
    c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  };
  const skipApi =
    (handler: MiddlewareHandler): MiddlewareHandler =>
    (c, next) =>
      isApiPath(c.req.path) ? next() : handler(c, next);

  app.use('*', skipApi(securityHeaders));
  app.use('*', skipApi(cacheControl));
  app.use('*', skipApi(serveStatic({ root: dir })));
  const spaFallback = serveStatic({ root: dir, path: '/index.html' });
  // Asset inexistente é 404 de verdade, não o HTML da SPA.
  app.use('*', (c, next) => {
    const path = c.req.path;
    return isApiPath(path) || path.startsWith('/assets/') ? next() : spaFallback(c, next);
  });
}
