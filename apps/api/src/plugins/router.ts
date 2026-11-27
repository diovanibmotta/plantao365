import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthEnv } from '../auth/index.js';
import type { PluginRegistry } from './registry.js';
import { PluginError } from './types.js';

export interface PluginsRouterDeps {
  registry: PluginRegistry;
  /** Token da CLI (`plantao-plugin install --token`); sem valor, só a master key instala. */
  installToken?: string;
}

/** Instalar e mudar plugins executa código no servidor: só a master key. */
const requireMaster = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.get('user')?.isMaster) return c.json({ error: 'forbidden' }, 403);
    await next();
  });

const sameSecret = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

const base64 = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const installSchema = z.object({ archive: base64, signature: base64 });
const settingsSchema = z.object({ settings: z.record(z.string(), z.unknown()) });

const fail = (c: Context, err: unknown) => {
  if (err instanceof PluginError)
    return c.json({ error: err.code, message: err.message }, err.status);
  throw err;
};

/**
 * Administração (`/plugins`) e rotas dos plugins (`/extensions/<id>/...`). Montado sob /api,
 * depois de sessão, CSRF, guestGuard e equipe: as rotas do plugin já recebem o usuário resolvido.
 */
export function createPluginsRouter({ registry, installToken }: PluginsRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();

  /** Install: master key logada ou `Authorization: Bearer <PLUGIN_INSTALL_TOKEN>` (CLI). */
  const canInstall: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const auth = c.req.header('authorization');
    if (auth?.startsWith('Bearer ')) {
      if (!installToken || !sameSecret(auth.slice(7), installToken)) {
        return c.json({ error: 'unauthenticated' }, 401);
      }
      return next();
    }
    return masterOnly(c, next);
  };
  const masterOnly = every(requireRole('manager'), requireMaster());

  router.get('/plugins/manifest', requireAuth(), (c) =>
    c.json({ plugins: registry.activeManifests() }),
  );

  router.get('/plugins', requireRole('manager'), async (c) =>
    c.json({ plugins: await registry.list() }),
  );

  router.get('/plugins/:id', requireRole('manager'), async (c) => {
    try {
      return c.json({ plugin: await registry.get(c.req.param('id')) });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.post(
    '/plugins',
    canInstall,
    bodyLimit({
      maxSize: 15 * 1024 * 1024,
      onError: (c) => c.json({ error: 'payload_too_large', message: 'Pacote grande demais.' }, 413),
    }),
    async (c) => {
      const body = installSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        return c.json(
          { error: 'invalid_body', message: 'Envie archive e signature em base64.' },
          400,
        );
      }
      try {
        const manifest = await registry.install(
          Buffer.from(body.data.archive, 'base64'),
          Buffer.from(body.data.signature, 'base64'),
          // Via token da CLI não há usuário: a auditoria fica sem ator (sistema).
          c.get('user')?.id ?? null,
        );
        return c.json(
          { plugin: manifest, message: `Plugin ${manifest.name} ${manifest.version} instalado.` },
          201,
        );
      } catch (err) {
        return fail(c, err);
      }
    },
  );

  router.post('/plugins/:id/enable', requireRole('manager'), requireMaster(), async (c) => {
    try {
      await registry.enable(c.req.param('id'), c.get('user')!.id);
      return c.json({ message: 'Plugin habilitado.' });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.post('/plugins/:id/disable', requireRole('manager'), requireMaster(), async (c) => {
    try {
      await registry.disable(c.req.param('id'), c.get('user')!.id);
      return c.json({ message: 'Plugin desabilitado.' });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.put('/plugins/:id/settings', requireRole('manager'), requireMaster(), async (c) => {
    const body = settingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'invalid_body', message: 'Configuração inválida.' }, 400);
    }
    try {
      await registry.updateSettings(c.req.param('id'), body.data.settings, c.get('user')!.id);
      return c.json({ message: 'Configuração do plugin salva.' });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.delete('/plugins/:id', requireRole('manager'), requireMaster(), async (c) => {
    try {
      const purge = c.req.query('purge') === 'true';
      await registry.uninstall(c.req.param('id'), c.get('user')!.id, purge);
      return c.json({
        message: purge ? 'Plugin removido com os dados.' : 'Plugin removido; dados mantidos.',
      });
    } catch (err) {
      return fail(c, err);
    }
  });

  const dispatch = (c: Context<AuthEnv>) => {
    const id = c.req.param('pluginId')!;
    const plugin = registry.routerFor(id);
    if (!plugin) return c.json({ error: 'plugin_not_found' }, 404);
    const url = new URL(c.req.url);
    const prefix = `/extensions/${id}`;
    url.pathname = url.pathname.slice(url.pathname.indexOf(prefix) + prefix.length) || '/';
    return plugin.fetch(new Request(url, c.req.raw), {
      user: c.get('user'),
      teamId: c.get('teamId'),
    });
  };
  router.all('/extensions/:pluginId', dispatch);
  router.all('/extensions/:pluginId/*', dispatch);

  return router;
}
