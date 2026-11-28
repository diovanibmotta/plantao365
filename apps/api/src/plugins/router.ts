import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthEnv } from '../auth/index.js';
import type { Sql } from '../db.js';
import { addTrustedKey, listTrustedKeys, removeTrustedKey, renameTrustedKey } from './keys.js';
import { isKernelCompatible } from './package.js';
import type { PluginRegistry } from './registry.js';
import { describeCatalogPlugin, type PluginStore } from './store.js';
import { PluginError } from './types.js';

export interface PluginsRouterDeps {
  registry: PluginRegistry;
  db: Sql;
  /** Loja de plugins; sem ela, o catálogo responde 503 `store_disabled`. */
  store?: PluginStore;
  /** Token da CLI (`plantao-plugin install --token`); sem valor, só um gestor logado instala. */
  installToken?: string;
}

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
const versionSchema = z.object({ version: z.string().min(1).max(50) });
const keyName = z.string().trim().min(1).max(100);
const newKeySchema = z.object({ name: keyName, publicKey: z.string().min(1).max(200) });
const renameKeySchema = z.object({ name: keyName });
const uuid = z.uuid();

const fail = (c: Context, err: unknown) => {
  if (err instanceof PluginError)
    return c.json({ error: err.code, message: err.message }, err.status);
  throw err;
};

/**
 * Administração (`/plugins`) e rotas dos plugins (`/extensions/<id>/...`). Montado sob /api,
 * depois de sessão, CSRF, guestGuard e equipe: as rotas do plugin já recebem o usuário resolvido.
 */
export function createPluginsRouter({
  registry,
  db,
  store,
  installToken,
}: PluginsRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();

  // Instalar e mudar plugins executa código no servidor: só gestor (ou, no install, o token).
  const manager = requireRole('manager');

  /** Install: gestor logado ou `Authorization: Bearer <PLUGIN_INSTALL_TOKEN>` (CLI). */
  const canInstall: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const auth = c.req.header('authorization');
    if (auth?.startsWith('Bearer ')) {
      if (!installToken || !sameSecret(auth.slice(7), installToken)) {
        return c.json({ error: 'unauthenticated' }, 401);
      }
      return next();
    }
    return manager(c, next);
  };

  const requireStore = () => {
    if (!store) throw new PluginError('store_disabled', 'A loja de plugins não está configurada.');
    return store;
  };
  const invalidBody = (c: Context, message: string) =>
    c.json({ error: 'invalid_body', message }, 400);

  router.get('/plugins/manifest', requireAuth(), (c) =>
    c.json({ plugins: registry.activeManifests() }),
  );

  router.get('/plugins', requireRole('manager'), async (c) =>
    c.json({ plugins: await registry.list() }),
  );

  // Rotas fixas antes de `/plugins/:id`.
  router.get('/plugins/catalog', manager, async (c) => {
    try {
      const catalog = await requireStore().catalog();
      const installed = new Map((await registry.list()).map((p) => [p.id, p.version]));
      return c.json({
        plugins: catalog.plugins.map((p) =>
          describeCatalogPlugin(p, installed.get(p.id) ?? null, (range) =>
            isKernelCompatible(range),
          ),
        ),
      });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.post('/plugins/catalog/:id/install', manager, async (c) => {
    const body = versionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalidBody(c, 'Informe a versão.');
    const id = c.req.param('id');
    try {
      const { archive, signature } = await requireStore().download(id, body.data.version);
      const manifest = await registry.install(archive, signature, c.get('user')!.id, {
        id,
        version: body.data.version,
      });
      return c.json(
        { plugin: manifest, message: `Plugin ${manifest.name} ${manifest.version} instalado.` },
        201,
      );
    } catch (err) {
      return fail(c, err);
    }
  });

  router.get('/plugins/keys', manager, async (c) => c.json({ keys: await listTrustedKeys(db) }));

  router.post('/plugins/keys', manager, async (c) => {
    const body = newKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalidBody(c, 'Informe nome e chave pública.');
    try {
      const key = await addTrustedKey(db, body.data, c.get('user')!.id);
      return c.json({ key, message: 'Chave cadastrada.' }, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  router.put('/plugins/keys/:keyId', manager, async (c) => {
    const body = renameKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalidBody(c, 'Informe o nome.');
    const id = uuid.safeParse(c.req.param('keyId'));
    if (!id.success) return c.json({ error: 'key_not_found' }, 404);
    try {
      await renameTrustedKey(db, id.data, body.data.name, c.get('user')!.id);
      return c.json({ message: 'Chave atualizada.' });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.delete('/plugins/keys/:keyId', manager, async (c) => {
    const id = uuid.safeParse(c.req.param('keyId'));
    if (!id.success) return c.json({ error: 'key_not_found' }, 404);
    try {
      await removeTrustedKey(db, id.data, c.get('user')!.id);
      return c.json({ message: 'Chave removida.' });
    } catch (err) {
      return fail(c, err);
    }
  });

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

  router.post('/plugins/:id/enable', manager, async (c) => {
    try {
      await registry.enable(c.req.param('id'), c.get('user')!.id);
      return c.json({ message: 'Plugin habilitado.' });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.post('/plugins/:id/disable', manager, async (c) => {
    try {
      await registry.disable(c.req.param('id'), c.get('user')!.id);
      return c.json({ message: 'Plugin desabilitado.' });
    } catch (err) {
      return fail(c, err);
    }
  });

  router.put('/plugins/:id/settings', manager, async (c) => {
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

  router.delete('/plugins/:id', manager, async (c) => {
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
