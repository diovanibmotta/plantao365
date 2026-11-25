import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatMinute, shiftDuration } from '@diovanibmotta/plantao365-shared';
import type { ShiftException } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { formatHours } from '../schedule/format';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';
import { describe, formatDate } from './types';

export const EXCEPTIONS_NEW_PATH = '/schedule-admin/exceptions/new';
export const exceptionPath = (date: string) => `/schedule-admin/exceptions/${date}`;
export const EXCEPTIONS_LIST_PATH = '/schedule-admin?tab=exceptions';

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

type WorkFilter = '' | 'default' | 'custom';

/** Listagem das exceções de horário por data; cadastro, edição e exclusão ficam no formulário. */
export function ShiftExceptionsList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ShiftException[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [work, setWork] = useState<WorkFilter>('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ShiftException[]>('/api/shift-exceptions', controller.signal)
      .then(setItems)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(describe(err, 'Não foi possível carregar as exceções.'));
        }
      });
    return () => controller.abort();
  }, []);

  const years = useMemo(
    () => [...new Set((items ?? []).map((e) => e.date.slice(0, 4)))].sort(),
    [items],
  );

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (items ?? []).filter(
      (e) =>
        (!term || normalizeSearch(`${e.note ?? ''} ${formatDate(e.date)}`).includes(term)) &&
        (!year || e.date.startsWith(year)) &&
        (!work || (work === 'custom') === (e.workPeriods !== null)),
    );
  }, [items, search, year, work]);

  const clear = () => {
    setSearch('');
    setYear('');
    setWork('');
  };

  const cta = (
    <Link to={EXCEPTIONS_NEW_PATH} className="btn primary">
      Nova exceção
    </Link>
  );

  return (
    <section aria-labelledby="sad-exc-title" className="sad-block">
      <PageHeader
        title="Exceções de horário"
        description="Datas em que o plantão e a jornada fogem do padrão da equipe."
        action={items && items.length > 0 ? cta : undefined}
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {items?.length === 0 && (
        <EmptyState action={cta}>
          Cadastre as datas especiais, como 24/12 e 31/12, para a geração da escala usar o horário
          certo.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por observação ou data"
            onClear={clear}
            clearable={Boolean(search || year || work)}
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
              aria-label="Jornada"
              value={work}
              onChange={(e) => setWork(e.target.value as WorkFilter)}
            >
              <option value="">Qualquer jornada</option>
              <option value="default">Jornada padrão</option>
              <option value="custom">Jornada própria</option>
            </select>
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Exceções de horário">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Observação</th>
                    <th scope="col">Plantão</th>
                    <th scope="col">Jornada</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr
                      key={e.date}
                      onClick={() => void navigate(exceptionPath(e.date))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{formatDate(e.date)}</td>
                      <td>{e.note ?? ''}</td>
                      <td>
                        {hh(e.startHour)}–{hh(e.endHour)}{' '}
                        <span className="ui-tag">
                          {formatHours(
                            shiftDuration({ startHour: e.startHour, endHour: e.endHour }),
                          )}
                        </span>
                      </td>
                      <td>
                        {e.workPeriods ? (
                          e.workPeriods
                            .map(
                              (p) => `${formatMinute(p.startMinute)}–${formatMinute(p.endMinute)}`,
                            )
                            .join(' | ') || 'Sem jornada'
                        ) : (
                          <span className="ui-tag">Padrão</span>
                        )}
                      </td>
                      <td className="ui-col-actions">
                        <Link
                          to={exceptionPath(e.date)}
                          className="btn sm"
                          aria-label={`Editar exceção de ${formatDate(e.date)}`}
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
          <p className="ui-count">
            {visible.length} de {items.length} {items.length === 1 ? 'registro' : 'registros'}
          </p>
        </>
      )}
    </section>
  );
}
