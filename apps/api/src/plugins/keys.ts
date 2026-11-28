import type { KeyObject } from 'node:crypto';
import { recordAudit } from '../audit/index.js';
import type { Sql } from '../db.js';
import { parsePublicKeys } from './package.js';
import { PluginError } from './types.js';

export interface TrustedKey {
  id: string;
  name: string;
  publicKey: string;
  createdAt: string;
}

interface KeyRow {
  id: string;
  name: string;
  public_key: string;
  created_at: Date;
}

const toKey = (r: KeyRow): TrustedKey => ({
  id: r.id,
  name: r.name,
  publicKey: r.public_key,
  createdAt: r.created_at.toISOString(),
});

const notFound = () => new PluginError('key_not_found', 'Chave não encontrada.');

export async function listTrustedKeys(sql: Sql): Promise<TrustedKey[]> {
  const rows = await sql<KeyRow[]>`
    select id, name, public_key, created_at from plugin_trusted_keys order by name, created_at`;
  return rows.map(toKey);
}

/** Chaves cadastradas na tela, prontas para verificar assinatura. */
export async function databaseKeys(sql: Sql): Promise<KeyObject[]> {
  return parsePublicKeys((await listTrustedKeys(sql)).map((k) => k.publicKey).join(','));
}

const isSingleKey = (value: string) => {
  try {
    // Vírgula separaria em duas chaves: o cadastro é de uma só.
    return !value.includes(',') && parsePublicKeys(value).length === 1;
  } catch {
    return false;
  }
};

export async function addTrustedKey(
  sql: Sql,
  input: { name: string; publicKey: string },
  actorId: string,
): Promise<TrustedKey> {
  const publicKey = input.publicKey.trim();
  if (!isSingleKey(publicKey)) {
    throw new PluginError('invalid_key', 'Informe a chave pública Ed25519 gerada pelo keygen.');
  }
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [row] = await tx<KeyRow[]>`
      insert into plugin_trusted_keys (name, public_key, created_by)
      values (${input.name}, ${publicKey}, ${actorId})
      on conflict (public_key) do nothing
      returning id, name, public_key, created_at`;
    if (!row) throw new PluginError('key_conflict', 'Esta chave já está cadastrada.');
    await recordAudit(tx, {
      actorId,
      action: 'plugin.key.add',
      entityType: 'plugin_key',
      entityId: row.id,
      after: { name: row.name, publicKey },
    });
    return toKey(row);
  });
}

export async function renameTrustedKey(
  sql: Sql,
  id: string,
  name: string,
  actorId: string,
): Promise<void> {
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [before] = await tx<{ name: string }[]>`
      select name from plugin_trusted_keys where id = ${id} for update`;
    if (!before) throw notFound();
    await tx`update plugin_trusted_keys set name = ${name} where id = ${id}`;
    await recordAudit(tx, {
      actorId,
      action: 'plugin.key.rename',
      entityType: 'plugin_key',
      entityId: id,
      before: { name: before.name },
      after: { name },
    });
  });
}

/** Plugins já instalados continuam: a assinatura é conferida só no install. */
export async function removeTrustedKey(sql: Sql, id: string, actorId: string): Promise<void> {
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [row] = await tx<KeyRow[]>`
      delete from plugin_trusted_keys where id = ${id}
      returning id, name, public_key, created_at`;
    if (!row) throw notFound();
    await recordAudit(tx, {
      actorId,
      action: 'plugin.key.remove',
      entityType: 'plugin_key',
      entityId: id,
      before: { name: row.name, publicKey: row.public_key },
    });
  });
}
