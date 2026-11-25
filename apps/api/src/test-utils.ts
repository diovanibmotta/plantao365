import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createDb, type Sql } from './db.js';
import { processDomainEvents } from './events/consumer.js';
import { loadMigrations, migrateUp } from './migrator.js';
import { createEventHandlers } from './notifications/handlers.js';

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];

export interface TestDb {
  sql: Sql;
  url: string;
  drop: () => Promise<void>;
}

const migrationsDir = path.resolve(import.meta.dirname, '../migrations');

/**
 * Cria um banco temporário isolado (nome aleatório) a partir do servidor de TEST_DATABASE_URL,
 * aplica todas as migrações e devolve a conexão. Seguro para testes em paralelo.
 */
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL não definida');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = createDb(TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const u = new URL(TEST_DATABASE_URL);
  u.pathname = `/${name}`;
  const url = u.toString();
  const sql = createDb(url, { max: 4 });
  if (options.migrate !== false) await migrateUp(sql, await loadMigrations(migrationsDir));

  return {
    sql,
    url,
    drop: async () => {
      await sql.end();
      const a = createDb(TEST_DATABASE_URL, { max: 1 });
      await a.unsafe(`drop database if exists "${name}" with (force)`);
      await a.end();
    },
  };
}

/**
 * Processa os eventos de domínio pendentes (o consumidor em produção roda em segundo plano).
 * Falha se algum evento der erro, para o teste enxergar o problema do handler.
 */
export async function drainEvents(
  sql: Sql,
  opts: { appBaseUrl?: string | undefined; now?: Date } = {},
): Promise<void> {
  const result = await processDomainEvents(
    sql,
    createEventHandlers({ appBaseUrl: opts.appBaseUrl }),
    { now: () => opts.now ?? new Date(), maxAttempts: 1 },
  );
  if (result.failed > 0 || result.retried > 0) {
    const rows = await sql<{ type: string; last_error: string | null }[]>`
      select type, last_error from domain_events where last_error is not null`;
    throw new Error(`Falha ao processar eventos: ${JSON.stringify(rows)}`);
  }
}
