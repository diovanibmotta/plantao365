import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { AuditTable } from '../audit/AuditTable';
import { buildAuditQuery, EMPTY_FILTERS, ENTITY_TYPES, PAGE_SIZE } from '../audit/types';
import type { AuditFilterValues, AuditPageData } from '../audit/types';
import { PageTitle } from '../team/PageTitle';

interface ActorOption {
  id: string;
  name: string;
}

type Outcome = { error: string } | { data: AuditPageData };

interface Loaded {
  query: string;
  outcome: Outcome;
}

export function AuditPage() {
  const [draft, setDraft] = useState<AuditFilterValues>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilterValues>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [actors, setActors] = useState<ActorOption[]>([]);
  const query = buildAuditQuery(applied, offset);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ActorOption[]>('/api/users', controller.signal)
      .then((users) => setActors(users.map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<AuditPageData>(`/api/audit?${query}`, controller.signal)
      .then((data) => setLoaded({ query, outcome: { data } }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : 'Não foi possível carregar a auditoria.';
        setLoaded({ query, outcome: { error } });
      });
    return () => controller.abort();
  }, [query]);

  const outcome = loaded?.query === query ? loaded.outcome : null;

  const set = (key: keyof AuditFilterValues) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setOffset(0);
  };

  const clear = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
  };

  const rangeInvalid = draft.from !== '' && draft.to !== '' && draft.from > draft.to;

  return (
    <section>
      <PageTitle>Auditoria</PageTitle>
      <form className="filters" onSubmit={apply} aria-label="Filtros de auditoria">
        <label>
          De
          <input type="date" value={draft.from} onChange={(e) => set('from')(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={draft.to} onChange={(e) => set('to')(e.target.value)} />
        </label>
        <label>
          Tipo de entidade
          <select value={draft.entityType} onChange={(e) => set('entityType')(e.target.value)}>
            <option value="">Todos</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ator
          <select value={draft.actorId} onChange={(e) => set('actorId')(e.target.value)}>
            <option value="">Todos</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit" className="btn primary" disabled={rangeInvalid}>
            Aplicar
          </button>
          <button type="button" className="btn" onClick={clear}>
            Limpar
          </button>
        </div>
        {rangeInvalid && (
          <p className="alert" role="alert">
            A data inicial deve ser anterior ou igual à final.
          </p>
        )}
      </form>

      {outcome === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {outcome !== null && 'error' in outcome && (
        <p className="alert" role="alert">
          {outcome.error}
        </p>
      )}
      {outcome !== null && 'data' in outcome && <Results data={outcome.data} onPage={setOffset} />}
    </section>
  );
}

function Results({ data, onPage }: { data: AuditPageData; onPage: (offset: number) => void }) {
  if (data.items.length === 0) {
    return <p className="status muted">Nenhum registro encontrado.</p>;
  }
  const first = data.offset + 1;
  const last = data.offset + data.items.length;
  return (
    <>
      <AuditTable items={data.items} />
      <nav className="pager" aria-label="Paginação">
        <button
          type="button"
          className="btn"
          disabled={data.offset === 0}
          onClick={() => onPage(Math.max(0, data.offset - PAGE_SIZE))}
        >
          Anterior
        </button>
        <span className="muted">
          {first}–{last} de {data.total}
        </span>
        <button
          type="button"
          className="btn"
          disabled={last >= data.total}
          onClick={() => onPage(data.offset + PAGE_SIZE)}
        >
          Próxima
        </button>
      </nav>
    </>
  );
}
