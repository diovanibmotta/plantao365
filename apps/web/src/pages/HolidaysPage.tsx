import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { HOLIDAYS_NEW_PATH, holidayPath } from '../holidays/paths';
import {
  errorMessage,
  formatHolidayDate,
  scopeLabel,
  SCOPES,
  yearOptions,
} from '../holidays/types';
import type { Holiday, HolidayScope } from '../holidays/types';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';

interface Loaded {
  year: number;
  outcome: { error: string } | { items: Holiday[] };
}

/** Listagem de feriados por ano; cadastro, edição e exclusão ficam no formulário. */
export function HolidaysPage() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'' | HolidayScope>('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ items: Holiday[] }>(`/api/holidays?year=${year}`, controller.signal)
      .then((data) => setLoaded({ year, outcome: { items: data.items } }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          year,
          outcome: { error: errorMessage(err, 'Não foi possível carregar os feriados.') },
        });
      });
    return () => controller.abort();
  }, [year]);

  const outcome = loaded?.year === year ? loaded.outcome : null;
  const items = outcome && 'items' in outcome ? outcome.items : null;

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return [...(items ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(
        (h) =>
          (!term ||
            normalizeSearch(`${h.name} ${formatHolidayDate(h.date)} ${h.date}`).includes(term)) &&
          (!scope || h.scope === scope),
      );
  }, [items, search, scope]);

  const clear = () => {
    setSearch('');
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
        action={cta}
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
            clearable={Boolean(search || scope)}
          >
            <select aria-label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions(year, currentYear).map((y) => (
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
            <EmptyState action={cta}>Nenhum feriado cadastrado em {year}.</EmptyState>
          ) : visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label={`Feriados de ${year}`}>
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
                  {visible.map((h) => (
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
            <p className="ui-count">
              {visible.length} de {items.length} {items.length === 1 ? 'registro' : 'registros'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
