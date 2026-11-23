import { Fragment, useState } from 'react';
import { entityLabel, formatDateTime } from './types';
import type { AuditItem, AuditJson } from './types';

function Json({ label, value }: { label: string; value: AuditJson }) {
  return (
    <div className="audit-json">
      <h3>{label}</h3>
      {value === null ? (
        <p className="muted">Sem valor.</p>
      ) : (
        <pre>{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}

function ActorCell({ item }: { item: AuditItem }) {
  if (item.actorName) {
    return (
      <>
        {item.actorName}
        {item.actorEmail && <span className="muted block">{item.actorEmail}</span>}
      </>
    );
  }
  if (item.actorId) return <span className="muted">Usuário removido ({item.actorId})</span>;
  return <span className="muted">Sistema</span>;
}

export function AuditTable({ items }: { items: AuditItem[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="table-wrap">
      <table className="audit-table">
        <caption className="sr-only">Registros de auditoria</caption>
        <thead>
          <tr>
            <th scope="col">Data/hora</th>
            <th scope="col">Ator</th>
            <th scope="col">Ação</th>
            <th scope="col">Entidade</th>
            <th scope="col">Motivo</th>
            <th scope="col">
              <span className="sr-only">Detalhes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const expanded = open.has(item.id);
            const detailsId = `audit-details-${item.id}`;
            return (
              <Fragment key={item.id}>
                <tr>
                  <td data-label="Data/hora">{formatDateTime(item.occurredAt)}</td>
                  <td data-label="Ator">
                    <ActorCell item={item} />
                  </td>
                  <td data-label="Ação">{item.action}</td>
                  <td data-label="Entidade">
                    {entityLabel(item.entityType)}
                    {item.entityId && <span className="muted block">{item.entityId}</span>}
                  </td>
                  <td data-label="Motivo">{item.reason ?? <span className="muted">—</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={() => toggle(item.id)}
                    >
                      {expanded ? 'Ocultar' : 'Detalhes'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="audit-details" id={detailsId}>
                    <td colSpan={6}>
                      <div className="audit-json-grid">
                        <Json label="Antes" value={item.before} />
                        <Json label="Depois" value={item.after} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
