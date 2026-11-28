import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { PLUGIN_ASSETS_PREFIX, type PluginRegistry } from './registry.js';

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/**
 * Front dos plugins ativos em `/plugins-assets/<id>/<versão>/<arquivo>`, na mesma origem do app
 * (sem mudar CSP). A versão é imutável por conteúdo (o install recusa outra), então o cache é longo.
 */
export function createPluginAssetsRouter({ registry }: { registry: PluginRegistry }): Hono {
  const router = new Hono();
  router.get(`${PLUGIN_ASSETS_PREFIX}/:id/:version/*`, async (c) => {
    const { id, version } = c.req.param();
    const rel = c.req.path.slice(`${PLUGIN_ASSETS_PREFIX}/${id}/${version}/`.length);
    const file = registry.webAssetPath(id, version, rel);
    if (!file) return c.notFound();
    const body = await readFile(file).catch(() => null);
    if (!body) return c.notFound();
    return c.body(body, 200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
  });
  return router;
}
