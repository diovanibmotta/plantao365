export type AuditJson =
  string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

export interface AuditEntryInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: AuditJson;
  after?: AuditJson;
  reason?: string | null;
}

export interface AuditRecord {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: AuditJson;
  after: AuditJson;
  reason: string | null;
}

export interface AuditFilters {
  from?: string;
  to?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  items: AuditRecord[];
  total: number;
  limit: number;
  offset: number;
}
