import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { KeyObject } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hono, type MiddlewareHandler } from 'hono';
import type {
  PluginContext,
  PluginDefinition,
  PluginEnv,
  PluginEventHandler,
  PluginJob,
} from '@diovanibmotta/plantao365-plugin-sdk';
import { recordAudit } from '../audit/index.js';
import { requireAuth, requireRole } from '../auth/index.js';
import type { Sql } from '../db.js';
import { publishEvent } from '../events/index.js';
import type { Logger } from '../logger.js';
import { loadMigrations, migrateUp, type MigrationScope } from '../migrator.js';
import type { DeliveryTarget } from './deliveries.js';
import { startLoop, type Loop } from './loop.js';
import { decodePackage, isKernelCompatible, sha256, verifySignature } from './package.js';
import {
  KERNEL_API_VERSION,
  PluginError,
  type PluginManifest,
  type PluginStatus,
  type PluginSummary,
} from './types.js';

export interface PluginRegistryDeps {
  sql: Sql;
  logger: Logger;
  /** Onde os pacotes são extraídos (cache local; a fonte de verdade é o banco). */
  pluginsDir: string;
  publicKeys: KeyObject[];
  /** Tempo máximo do `setup` de um plugin. */
  setupTimeoutMs?: number;
}

interface ActivePlugin {
  manifest: PluginManifest;
  sha256: string;
  definition: PluginDefinition | undefined;
  router: Hono<PluginEnv>;
  subscribers: Map<string, PluginEventHandler>;
  jobs: Loop[];
}

interface PackageRow {
  version: string;
  sha256: string;
  manifest: PluginManifest;
  archive: Buffer;
  settings: Record<string, unknown>;
}

const MIN_JOB_INTERVAL_MS = 1000;

export const pluginSchema = (id: string) => `plugin_${id.replaceAll('-', '_')}`;
const migrationScope = (id: string): MigrationScope => ({
  scope: `plugin:${id}`,
  schema: pluginSchema(id),
});
const errorMessage = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 1000);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Kernel de plugins: instala pacotes assinados, aplica as migrações no schema do plugin, carrega o
 * `server/index.js` (import dinâmico com cache-busting pelo sha256, então upgrade não exige restart)
 * e expõe rotas, assinaturas de evento e jobs. Falha de um plugin vira status `failed`, nunca
 * derruba o core.
 */
export class PluginRegistry implements DeliveryTarget {
  private readonly active = new Map<string, ActivePlugin>();
  /** Serializa as mutações (install/enable/disable…) desta instância. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PluginRegistryDeps) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ---- consultas usadas pelo core ----

  activeIds(): string[] {
    return [...this.active.keys()];
  }

  routerFor(id: string): Hono<PluginEnv> | undefined {
    return this.active.get(id)?.router;
  }

  subscribersOf(type: string): string[] {
    return [...this.active].filter(([, p]) => p.subscribers.has(type)).map(([id]) => id);
  }

  handlerFor(pluginId: string, type: string): PluginEventHandler | undefined {
    return this.active.get(pluginId)?.subscribers.get(type);
  }

  /** Plugins ativos, para o front montar telas e menus (Fase 3). */
  activeManifests() {
    return [...this.active.values()].map(({ manifest, sha256: sha }) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      web: manifest.web ? { entry: manifest.web.entry, build: sha.slice(0, 16) } : null,
    }));
  }

  async list(): Promise<PluginSummary[]> {
    const rows = await this.deps.sql<
      {
        id: string;
        version: string;
        status: PluginStatus;
        error: string | null;
        settings: Record<string, unknown>;
        manifest: PluginManifest;
        installed_at: Date;
        updated_at: Date;
      }[]
    >`
      select p.id, p.version, p.status, p.error, p.settings, k.manifest, p.installed_at,
        p.updated_at
      from plugins p
      join plugin_packages k on k.plugin_id = p.id and k.version = p.version
      order by p.id`;
    return rows.map((r) => ({
      id: r.id,
      name: r.manifest.name,
      version: r.version,
      description: r.manifest.description ?? null,
      status: r.status,
      error: r.error,
      settings: r.settings,
      active: this.active.has(r.id),
      installedAt: r.installed_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  // ---- ciclo de vida ----

  /**
   * Valida assinatura, formato e compatibilidade e grava o pacote. Reinstalar a mesma versão só é
   * aceito com o mesmo conteúdo. Se o plugin estiver habilitado, a nova versão é ativada na hora.
   */
  install(archive: Buffer, signature: Buffer, actorId: string): Promise<PluginManifest> {
    return this.exclusive(async () => {
      verifySignature(archive, signature, this.deps.publicKeys);
      const { manifest } = decodePackage(archive);
      if (!isKernelCompatible(manifest.kernelApi)) {
        throw new PluginError(
          'incompatible_kernel',
          `O plugin exige o kernel ${manifest.kernelApi}; esta versão é ${KERNEL_API_VERSION}.`,
        );
      }
      const hash = sha256(archive);
      const status = await this.deps.sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        const [existing] = await tx<{ sha256: string }[]>`
          select sha256 from plugin_packages
          where plugin_id = ${manifest.id} and version = ${manifest.version}`;
        if (existing && existing.sha256 !== hash) {
          throw new PluginError(
            'version_conflict',
            `A versão ${manifest.version} de ${manifest.id} já foi instalada com outro conteúdo.`,
          );
        }
        const [row] = await tx<{ status: PluginStatus }[]>`
          insert into plugins (id, version) values (${manifest.id}, ${manifest.version})
          on conflict (id) do update set version = excluded.version, updated_at = now()
          returning status`;
        if (!existing) {
          await tx`
            insert into plugin_packages (plugin_id, version, sha256, manifest, archive, signature)
            values (${manifest.id}, ${manifest.version}, ${hash},
              ${tx.json(JSON.parse(JSON.stringify(manifest)))}, ${archive}, ${signature})`;
        }
        await recordAudit(tx, {
          actorId,
          action: 'plugin.install',
          entityType: 'plugin',
          entityId: manifest.id,
          after: { version: manifest.version, sha256: hash },
        });
        return row!.status;
      });
      if (status === 'enabled' && this.active.get(manifest.id)?.sha256 !== hash) {
        await this.deactivate(manifest.id);
        await this.activateOrFail(manifest.id);
      }
      return manifest;
    });
  }

  enable(id: string, actorId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.requireExists(id);
      if (!this.active.has(id)) await this.activateOrFail(id);
      await this.setStatus(id, 'enabled', null, actorId, 'plugin.enable');
    });
  }

  disable(id: string, actorId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.requireExists(id);
      await this.deactivate(id);
      await this.setStatus(id, 'disabled', null, actorId, 'plugin.disable');
    });
  }

  updateSettings(id: string, settings: Record<string, unknown>, actorId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.requireExists(id);
      await this.deps.sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        const [before] = await tx<{ settings: Record<string, unknown> }[]>`
          select settings from plugins where id = ${id} for update`;
        await tx`
          update plugins set settings = ${tx.json(JSON.parse(JSON.stringify(settings)))},
            updated_at = now()
          where id = ${id}`;
        await recordAudit(tx, {
          actorId,
          action: 'plugin.settings',
          entityType: 'plugin',
          entityId: id,
          before: JSON.parse(JSON.stringify(before!.settings)),
          after: JSON.parse(JSON.stringify(settings)),
        });
      });
      if (this.active.has(id)) {
        await this.deactivate(id);
        await this.activateOrFail(id);
      }
    });
  }

  /** Remove o plugin. Por padrão mantém o schema (dados); `purge` reverte as migrações. */
  uninstall(id: string, actorId: string, purge = false): Promise<void> {
    return this.exclusive(async () => {
      await this.requireExists(id);
      await this.deactivate(id);
      if (purge) {
        const schema = pluginSchema(id);
        await this.deps.sql`drop schema if exists ${this.deps.sql(schema)} cascade`;
        await this.deps.sql`
          delete from schema_migrations where starts_with(name, ${`plugin:${id}/`})`;
      }
      await this.deps.sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        await tx`delete from plugins where id = ${id}`;
        await recordAudit(tx, {
          actorId,
          action: 'plugin.uninstall',
          entityType: 'plugin',
          entityId: id,
          after: { purge },
        });
      });
    });
  }

  /** No boot: ativa os plugins habilitados; os que falharem ficam `failed`. */
  loadEnabled(): Promise<void> {
    return this.exclusive(async () => {
      const rows = await this.deps.sql<{ id: string }[]>`
        select id from plugins where status = 'enabled' order by id`;
      for (const { id } of rows) {
        await this.activateOrFail(id).catch(() => undefined);
      }
    });
  }

  stopAll(): Promise<void> {
    return this.exclusive(async () => {
      for (const id of [...this.active.keys()]) await this.deactivate(id);
    });
  }

  // ---- internos ----

  private async requireExists(id: string): Promise<void> {
    const [row] = await this.deps.sql`select 1 from plugins where id = ${id}`;
    if (!row) throw new PluginError('plugin_not_found', 'Plugin não encontrado.');
  }

  private async setStatus(
    id: string,
    status: PluginStatus,
    error: string | null,
    actorId: string | null,
    action?: string,
  ): Promise<void> {
    await this.deps.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`
        update plugins set status = ${status}, error = ${error}, updated_at = now()
        where id = ${id}`;
      if (action) {
        await recordAudit(tx, { actorId, action, entityType: 'plugin', entityId: id });
      }
    });
  }

  private async activateOrFail(id: string): Promise<void> {
    try {
      await this.activate(id);
    } catch (err) {
      const message = errorMessage(err);
      this.deps.logger.error({ pluginId: id, err: message }, 'Falha ao ativar plugin');
      await this.setStatus(id, 'failed', message, null);
      throw new PluginError('activation_failed', `Falha ao ativar o plugin: ${message}`);
    }
  }

  private async activate(id: string): Promise<void> {
    const { sql, logger: rootLogger } = this.deps;
    const [row] = await sql<PackageRow[]>`
      select k.version, k.sha256, k.manifest, k.archive, p.settings
      from plugins p
      join plugin_packages k on k.plugin_id = p.id and k.version = p.version
      where p.id = ${id}`;
    if (!row) throw new PluginError('plugin_not_found', 'Plugin não encontrado.');
    const { manifest } = row;
    const dir = await this.extract(id, row);
    const logger = rootLogger.child({ pluginId: id, pluginVersion: manifest.version });

    const migrationsDir = path.join(dir, 'migrations');
    if (existsSync(migrationsDir)) {
      await migrateUp(sql, await loadMigrations(migrationsDir), migrationScope(id));
    }

    const plugin: ActivePlugin = {
      manifest,
      sha256: row.sha256,
      definition: undefined,
      router: this.createRouter(logger),
      subscribers: new Map(),
      jobs: [],
    };
    const pendingJobs: PluginJob[] = [];
    try {
      if (manifest.server) {
        const url = `${pathToFileURL(path.join(dir, manifest.server.entry)).href}?v=${row.sha256}`;
        const mod = (await import(url)) as { default?: PluginDefinition };
        if (typeof mod.default?.setup !== 'function') {
          throw new Error(`${manifest.server.entry} deve exportar definePlugin({ setup })`);
        }
        plugin.definition = mod.default;
        await withTimeout(
          Promise.resolve(
            mod.default.setup(this.createContext(id, row, plugin, pendingJobs, logger)),
          ),
          this.deps.setupTimeoutMs ?? 10_000,
          'setup',
        );
      }
      plugin.jobs = pendingJobs.map((job) =>
        startLoop(job.run.bind(job), job.intervalMs, (err) =>
          logger.error({ job: job.name, err: errorMessage(err) }, 'Falha no job do plugin'),
        ),
      );
    } catch (err) {
      await Promise.resolve(plugin.definition?.teardown?.()).catch(() => undefined);
      throw err;
    }
    this.active.set(id, plugin);
    logger.info({}, 'Plugin ativado');
  }

  private async deactivate(id: string): Promise<void> {
    const plugin = this.active.get(id);
    if (!plugin) return;
    this.active.delete(id);
    await Promise.all(plugin.jobs.map((j) => j.stop()));
    try {
      await plugin.definition?.teardown?.();
    } catch (err) {
      this.deps.logger.warn({ pluginId: id, err: errorMessage(err) }, 'Falha no teardown');
    }
  }

  /** Extrai o pacote em `<pluginsDir>/<id>/<sha>`; o marcador `.complete` evita cache parcial. */
  private async extract(id: string, row: PackageRow): Promise<string> {
    const dir = path.join(this.deps.pluginsDir, id, row.sha256.slice(0, 16));
    if (existsSync(path.join(dir, '.complete'))) return dir;
    const { files } = decodePackage(row.archive);
    for (const [rel, content] of files) {
      const target = path.join(dir, rel);
      // decodePackage já recusa `..`; a checagem garante que nada escapa do diretório.
      if (!target.startsWith(dir + path.sep)) throw new Error(`Caminho inválido: ${rel}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '.complete'), row.sha256);
    return dir;
  }

  private createRouter(logger: Logger): Hono<PluginEnv> {
    const router = new Hono<PluginEnv>();
    // O dispatcher repassa usuário e equipe resolvidos pelo core no `env` da requisição.
    router.use(async (c, next) => {
      const env = c.env as PluginEnv['Variables'] | undefined;
      c.set('user', env?.user ?? null);
      c.set('teamId', env?.teamId ?? null);
      await next();
    });
    router.onError((err, c) => {
      logger.error({ err: errorMessage(err), path: c.req.path }, 'Erro em rota do plugin');
      return c.json({ error: 'plugin_error', message: 'Erro interno no plugin.' }, 500);
    });
    return router;
  }

  private createContext(
    id: string,
    row: PackageRow,
    plugin: ActivePlugin,
    pendingJobs: PluginJob[],
    logger: Logger,
  ): PluginContext {
    const { sql } = this.deps;
    const schema = pluginSchema(id);
    return {
      id,
      version: row.version,
      settings: row.settings,
      router: plugin.router,
      db: sql,
      schema,
      withSchema: (fn) =>
        sql.begin(async (txRaw) => {
          const tx = txRaw as unknown as Sql;
          await tx`select set_config('search_path', ${`"${schema}", public`}, true)`;
          return fn(tx);
        }) as never,
      logger,
      audit: (tx, entry) =>
        recordAudit(tx, {
          actorId: entry.actorId,
          action: `${id}.${entry.action}`,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: entry.before as never,
          after: entry.after as never,
          reason: entry.reason ?? null,
        }),
      events: {
        async publish(tx, name, payload, opts) {
          if (!/^[a-z0-9_.-]{1,80}$/.test(name))
            throw new Error(`Nome de evento inválido: ${name}`);
          await publishEvent(tx, `${id}.${name}` as never, payload as never, opts);
        },
        subscribe(type, handler) {
          plugin.subscribers.set(type, handler as PluginEventHandler);
        },
      },
      jobs: {
        register(job) {
          if (job.intervalMs < MIN_JOB_INTERVAL_MS) {
            throw new Error(`Job ${job.name}: intervalo mínimo de ${MIN_JOB_INTERVAL_MS} ms`);
          }
          pendingJobs.push(job);
        },
      },
      auth: {
        requireAuth: () => requireAuth() as unknown as MiddlewareHandler<PluginEnv>,
        requireRole: (role) => requireRole(role) as unknown as MiddlewareHandler<PluginEnv>,
      },
    };
  }
}
