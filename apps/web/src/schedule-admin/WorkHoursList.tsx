import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatMinute, sortWorkPeriods, workMinutes } from '@plantao365/shared';
import type { WorkPeriod } from '@plantao365/shared';
import { api } from '../api/client';
import {
  EmptyState,
  FilterBar,
  normalizeSearch,
  PageHeader,
  Pagination,
  usePagination,
} from '@plantao365/web-sdk';
import { WORK_HOURS_NEW_PATH, workHoursPath } from './paths';
import { describe } from './types';

export const formatDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;

type PartFilter = '' | 'morning' | 'afternoon' | 'evening';

/** Turno do período pelo horário de início: manhã até 12:00, tarde até 18:00, noite depois. */
const partOf = (p: WorkPeriod): Exclude<PartFilter, ''> =>
  p.startMinute < 720 ? 'morning' : p.startMinute < 1080 ? 'afternoon' : 'evening';

/** Jornada de trabalho do time: um registro por período; cadastro e edição em rota própria. */
export function WorkHoursList() {
  const [periods, setPeriods] = useState<WorkPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [part, setPart] = useState<PartFilter>('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ periods: WorkPeriod[] }>('/api/work-hours', controller.signal)
      .then((r) => setPeriods(sortWorkPeriods(r.periods)))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(describe(err, 'Não foi possível carregar a jornada.'));
        }
      });
    return () => controller.abort();
  }, []);

  // Guarda a posição original: ela identifica o período na rota de edição.
  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (periods ?? [])
      .map((p, i) => ({ p, i }))
      .filter(
        ({ p, i }) =>
          (!term ||
            normalizeSearch(
              `${p.name ?? ''} Período ${i + 1} ${formatMinute(p.startMinute)} ${formatMinute(p.endMinute)}`,
            ).includes(term)) &&
          (!part || partOf(p) === part),
      );
  }, [periods, search, part]);

  const pager = usePagination(visible, [search, part].join('|'));

  const clear = () => {
    setSearch('');
    setPart('');
  };

  const cta = (
    <Link to={WORK_HOURS_NEW_PATH} className="btn primary">
      Novo período
    </Link>
  );

  return (
    <section className="sad-block">
      <PageHeader
        title="Jornada de trabalho"
        description="Períodos em que todo o time está trabalhando. Aparecem destacados nas visões de dia e semana do calendário."
        action={periods && periods.length > 0 ? cta : undefined}
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {periods === null && !error && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {periods?.length === 0 && (
        <EmptyState action={cta}>
          Sem jornada definida. Cadastre os períodos de trabalho do time para destacá-los no
          calendário.
        </EmptyState>
      )}
      {periods && periods.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome ou horário"
            onClear={clear}
            clearable={Boolean(search || part)}
          >
            <select
              aria-label="Turno"
              value={part}
              onChange={(e) => setPart(e.target.value as PartFilter)}
            >
              <option value="">Todos os turnos</option>
              <option value="morning">Manhã (até 12:00)</option>
              <option value="afternoon">Tarde (12:00 a 18:00)</option>
              <option value="evening">Noite (após 18:00)</option>
            </select>
          </FilterBar>
          {visible.length === 0 && (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          )}
          {visible.length > 0 && (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Jornada de trabalho">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">Início</th>
                    <th scope="col">Fim</th>
                    <th scope="col">Duração</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map(({ p, i }) => (
                    <tr key={`${p.startMinute}-${p.endMinute}`}>
                      <th scope="row">{p.name || `Período ${i + 1}`}</th>
                      <td>{formatMinute(p.startMinute)}</td>
                      <td>{formatMinute(p.endMinute)}</td>
                      <td>{formatDuration(p.endMinute - p.startMinute)}</td>
                      <td className="ui-col-actions">
                        <Link
                          to={workHoursPath(i)}
                          className="btn sm"
                          aria-label={`Editar período ${i + 1}`}
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
          <Pagination
            noun={['período', 'períodos']}
            total={periods.length}
            filtered={visible.length}
            page={pager.page}
            pages={pager.pages}
            pageSize={pager.pageSize}
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
          <p className="ui-count">Total: {formatDuration(workMinutes(periods))} por dia útil.</p>
        </>
      )}
    </section>
  );
}
