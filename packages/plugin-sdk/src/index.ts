import type { Hono, MiddlewareHandler } from 'hono';
import type postgres from 'postgres';

/*
 * Contrato v1.0.0 do kernel (KERNEL_API_VERSION em apps/api/src/plugins/types.ts). O manifesto
 * declara `kernelApi: "^MAJOR.MINOR.PATCH"`; o kernel recusa outro major ou minor/patch mais novo.
 * Só tipos: a API importa este pacote com `import type`, sem dependência em runtime.
 */

export type PluginSql = postgres.Sql;
export type PluginTx = postgres.Sql | postgres.TransactionSql;

export type PluginRole = 'manager' | 'member' | 'guest';

/** Usuário da requisição, como o core o resolve (sessão + equipe ativa). */
export interface PluginUser {
  id: string;
  email: string;
  name: string;
  role: PluginRole;
  isMaster: boolean;
}

export interface PluginEnv {
  Variables: { user: PluginUser | null; teamId: string | null };
}

export interface PluginLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export interface PluginEvent<P = unknown> {
  id: string;
  type: string;
  payload: P;
  createdAt: Date;
}

/** Roda na transação que marca a entrega como processada: erro = nova tentativa depois. */
export type PluginEventHandler<P = unknown> = (
  tx: PluginSql,
  event: PluginEvent<P>,
) => Promise<void>;

export interface PluginJob {
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

export interface PluginAuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export interface PluginContext {
  id: string;
  version: string;
  /** Configuração do plugin gravada pelo administrador; valide no `setup`. */
  settings: Record<string, unknown>;
  /** Rotas servidas em `/api/extensions/<id>/...`, depois de sessão, CSRF e equipe do core. */
  router: Hono<PluginEnv>;
  db: PluginSql;
  /** Schema exclusivo do plugin (`plugin_<id>`), onde as migrações do pacote criam as tabelas. */
  schema: string;
  /** Transação com `search_path` = schema do plugin, public. */
  withSchema<T>(fn: (tx: PluginSql) => Promise<T>): Promise<T>;
  logger: PluginLogger;
  /** Grava no audit_log do core; a ação recebe o prefixo `<id>.`. */
  audit(tx: PluginTx, entry: PluginAuditEntry): Promise<void>;
  events: {
    /** Publica `<id>.<name>` na transação informada (outbox `domain_events`). */
    publish(
      tx: PluginTx,
      name: string,
      payload: unknown,
      opts?: { dedupeKey?: string },
    ): Promise<void>;
    /** Assina um evento do core (ex.: `team.member_added`) ou de outro plugin. */
    subscribe<P = unknown>(type: string, handler: PluginEventHandler<P>): void;
  };
  jobs: { register(job: PluginJob): void };
  auth: {
    requireAuth(): MiddlewareHandler<PluginEnv>;
    requireRole(role: PluginRole): MiddlewareHandler<PluginEnv>;
  };
}

export interface PluginDefinition {
  setup(ctx: PluginContext): void | Promise<void>;
  /** Chamado ao desabilitar/atualizar; jobs e rotas já são removidos pelo kernel. */
  teardown?(): void | Promise<void>;
}

/** Identidade: só dá tipo ao `export default` do `server/index.js` do plugin. */
export const definePlugin = (definition: PluginDefinition): PluginDefinition => definition;
