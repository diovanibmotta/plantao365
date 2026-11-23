import type postgres from 'postgres';
import { z } from 'zod';
import type { Sql } from '../db.js';
import type { AuditEntryInput, AuditFilters, AuditJson, AuditPage, AuditRecord } from './types.js';

export type SqlOrTx = Sql | postgres.TransactionSql;

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

const jsonValue: z.ZodType<AuditJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const auditEntrySchema = z.object({
  actorId: z.uuid().nullable(),
  action: z.string().trim().min(1).max(100),
  entityType: z.string().trim().min(1).max(100),
  entityId: z.string().trim().min(1).max(200).nullish(),
  before: jsonValue.optional(),
  after: jsonValue.optional(),
  reason: z.string().trim().min(1).max(2000).nullish(),
});

const isoDateTime = z.iso.datetime({ offset: true });

export const auditFiltersSchema = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    actorId: z.uuid().optional(),
    entityType: z.string().trim().min(1).max(100).optional(),
    entityId: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine((f) => !f.from || !f.to || Date.parse(f.from) <= Date.parse(f.to), {
    message: 'from deve ser anterior ou igual a to',
    path: ['from'],
  });

export async function recordAudit(sqlOrTx: SqlOrTx, entry: AuditEntryInput): Promise<void> {
  const e = auditEntrySchema.parse(entry);
  const sql = sqlOrTx as Sql;
  await sql`
    insert into audit_log (actor_id, action, entity_type, entity_id, before, after, reason)
    values (
      ${e.actorId},
      ${e.action},
      ${e.entityType},
      ${e.entityId ?? null},
      ${e.before === undefined ? null : sql.json(e.before)},
      ${e.after === undefined ? null : sql.json(e.after)},
      ${e.reason ?? null}
    )`;
}

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: AuditJson;
  after: AuditJson;
  reason: string | null;
  actor_name: string | null;
  actor_email: string | null;
}

function toRecord(r: AuditRow): AuditRecord {
  return {
    id: String(r.id),
    occurredAt: r.occurred_at.toISOString(),
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorEmail: r.actor_email,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    before: r.before,
    after: r.after,
    reason: r.reason,
  };
}

export async function listAudit(sqlOrTx: SqlOrTx, filters: AuditFilters = {}): Promise<AuditPage> {
  const sql = sqlOrTx as Sql;
  const limit = Math.min(
    Math.max(Math.trunc(filters.limit ?? AUDIT_DEFAULT_LIMIT), 1),
    AUDIT_MAX_LIMIT,
  );
  const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);

  const where = sql`
    where true
    ${filters.from ? sql`and a.occurred_at >= ${filters.from}::timestamptz` : sql``}
    ${filters.to ? sql`and a.occurred_at <= ${filters.to}::timestamptz` : sql``}
    ${filters.actorId ? sql`and a.actor_id = ${filters.actorId}` : sql``}
    ${filters.entityType ? sql`and a.entity_type = ${filters.entityType}` : sql``}
    ${filters.entityId ? sql`and a.entity_id = ${filters.entityId}` : sql``}`;

  const rows = await sql<AuditRow[]>`
    select a.id, a.occurred_at, a.actor_id, a.action, a.entity_type, a.entity_id,
      a.before, a.after, a.reason, u.name as actor_name, u.email as actor_email
    from audit_log a left join users u on u.id = a.actor_id ${where}
    order by a.occurred_at desc, a.id desc
    limit ${limit} offset ${offset}`;
  const counted = await sql<{ total: string }[]>`
    select count(*)::text as total from audit_log a ${where}`;

  return { items: rows.map(toRecord), total: Number(counted[0]?.total ?? 0), limit, offset };
}
