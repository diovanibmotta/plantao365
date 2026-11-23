export type AuditJson =
  string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

export interface AuditItem {
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

export interface AuditPageData {
  items: AuditItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditFilterValues {
  from: string;
  to: string;
  entityType: string;
  actorId: string;
}

export const EMPTY_FILTERS: AuditFilterValues = { from: '', to: '', entityType: '', actorId: '' };

export const PAGE_SIZE = 50;

export const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'user', label: 'Usuário' },
  { value: 'holiday', label: 'Feriado' },
  { value: 'unavailability', label: 'Indisponibilidade' },
  { value: 'schedule', label: 'Escala' },
  { value: 'shift', label: 'Plantão' },
  { value: 'swap', label: 'Troca' },
  { value: 'adjustment', label: 'Ajuste' },
];

export function entityLabel(type: string): string {
  return ENTITY_TYPES.find((e) => e.value === type)?.label ?? type;
}

const OFFSET = '-03:00';

export function buildAuditQuery(filters: AuditFilterValues, offset: number): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', `${filters.from}T00:00:00.000${OFFSET}`);
  if (filters.to) params.set('to', `${filters.to}T23:59:59.999${OFFSET}`);
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.actorId.trim()) params.set('actorId', filters.actorId.trim());
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return params.toString();
}

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'medium',
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}
