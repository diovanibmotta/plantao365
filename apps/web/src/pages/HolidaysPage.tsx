import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { HOLIDAYS_NEW_PATH, holidayPath } from '../holidays/paths';
import { errorMessage, formatHolidayDate, scopeLabel, SCOPES } from '../holidays/types';
import type { Holiday, HolidayScope } from '../holidays/types';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';
import { Pagination, usePagination } from '../ui/Pagination';

type Outcome = { error: string } | { items: Holiday[] };

/** Listagem de feriados; cadastro, edição e exclusão ficam no formulário. */
export function HolidaysPage() {
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [scope, setScope] = useState<'' | HolidayScope>('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ items: Holiday[] }>('/api/holidays', controller.signal)
      .then((data) => setOutcome({ items: data.items }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setOutcome({ error: errorMessage(err, 'Não foi possível carregar os feriados.') });
      });
    return () => controller.abort();
  }, []);

  const items = outcome && 'items' in outcome ? outcome.items : null;
  const years = useMemo(
    () => [...new Set((items ?? []).map((h) => h.date.slice(0, 4)))].sort(),
    [items],
  );

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return [...(items ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(
        (h) =>
          (!term ||
            normalizeSearch(`${h.name} ${formatHolidayDate(h.date)} ${h.date}`).includes(term)) &&
          (!year || h.date.startsWith(year)) &&
          (!scope || h.scope === scope),
      );
  }, [items, search, year, scope]);

  const pager = usePagination(visible, [search, year, scope].join('|'));
  const clear = () => {
    setSearch('');
    setYear('');
    setScope('');
  };

  const cta = (
    <Link to={HOLIDAYS_NEW_PATH} className="btn primary">
      Novo feriado
    </Link>
  );

  return (
    <section>
      <PageHeader
        title="Feriados"
        description="Feriado conta como plantão de 24h (08:00 às 08:00)."
        action={items && items.length > 0 ? cta : undefined}
      />
      {outcome === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {outcome && 'error' in outcome && (
        <p className="alert" role="alert">
          {outcome.error}
        </p>
      )}
      {items && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome ou data"
            onClear={clear}
            clearable={Boolean(search || year || scope)}
          >
            <select aria-label="Ano" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Todos os anos</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              aria-label="Abrangência"
              value={scope}
              onChange={(e) => setScope(e.target.value as '' | HolidayScope)}
            >
              <option value="">Qualquer abrangência</option>
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </FilterBar>
          {items.length === 0 ? (
            <EmptyState action={cta}>Nenhum feriado cadastrado.</EmptyState>
          ) : visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Feriados">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Nome</th>
                    <th scope="col">Abrangência</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((h) => (
                    <tr
                      key={h.id}
                      onClick={() => void navigate(holidayPath(h.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{formatHolidayDate(h.date)}</td>
                      <td>{h.name}</td>
                      <td>
                        <span className="ui-tag">{scopeLabel(h.scope)}</span>
                      </td>
                      <td className="ui-col-actions">
                        <Link
                          to={holidayPath(h.id)}
                          className="btn sm"
                          aria-label={`Editar ${h.name}`}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          Editar
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {items.length > 0 && (
            <Pagination
              total={items.length}
              filtered={visible.length}
              page={pager.page}
              pages={pager.pages}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
              onPageSize={pager.setPageSize}
            />
          )}
        </>
      )}
    </section>
  );
}
