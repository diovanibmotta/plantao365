import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';
import { SCHEDULE_NEW_PATH, schedulePath } from './paths';
import { ConflictBadge } from './ConflictBadge';
import { StatusPill } from './StatusPill';
import { describe, formatDate } from './types';
import type { ScheduleDto } from './types';

type StatusFilter = '' | ScheduleDto['status'];

const STATUS_LABEL: Record<ScheduleDto['status'], string> = {
  draft: 'Rascunho',
  published: 'Publicada',
};

/** Listagem das escalas; gerar e abrir (editar, publicar, descartar) ficam em rotas próprias. */
export function SchedulesList() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<ScheduleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [onDate, setOnDate] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ScheduleDto[]>('/api/schedules', controller.signal)
      .then(setSchedules)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(describe(err, 'Não foi possível carregar as escalas.'));
        }
      });
    return () => controller.abort();
  }, []);

  // Datas ISO (AAAA-MM-DD) comparam corretamente como string.
  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (schedules ?? []).filter(
      (s) =>
        (!term ||
          normalizeSearch(
            `${formatDate(s.startDate)} ${formatDate(s.endDate)} ${STATUS_LABEL[s.status]}`,
          ).includes(term)) &&
        (!status || s.status === status) &&
        (!onDate || (s.startDate <= onDate && onDate <= s.endDate)),
    );
  }, [schedules, search, status, onDate]);

  const clear = () => {
    setSearch('');
    setStatus('');
    setOnDate('');
  };

  const cta = (
    <Link to={SCHEDULE_NEW_PATH} className="btn primary">
      Gerar escala
    </Link>
  );

  return (
    <section className="sad-block">
      <PageHeader
        title="Escalas"
        description="Rascunhos e escalas publicadas da equipe."
        action={schedules && schedules.length > 0 ? cta : undefined}
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {schedules === null && !error && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {schedules?.length === 0 && (
        <EmptyState action={cta}>
          Nenhuma escala criada. Gere um rascunho para um período e publique quando estiver pronto.
        </EmptyState>
      )}
      {schedules && schedules.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por período ou situação"
            onClear={clear}
            clearable={Boolean(search || status || onDate)}
          >
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="">Todas as situações</option>
              <option value="draft">Rascunho</option>
              <option value="published">Publicada</option>
            </select>
            <input
              type="date"
              aria-label="Contém a data"
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
            />
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhuma escala encontrada.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Escalas">
                <thead>
                  <tr>
                    <th scope="col">Período</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const period = `${formatDate(s.startDate)} a ${formatDate(s.endDate)}`;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => void navigate(schedulePath(s.id))}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>{period}</td>
                        <td>
                          <StatusPill status={s.status} />
                        </td>
                        <td>
                          <ConflictBadge conflicts={s.conflicts} />
                        </td>
                        <td className="ui-col-actions">
                          <Link
                            to={schedulePath(s.id)}
                            className="btn sm"
                            aria-label={`Abrir escala de ${period}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Abrir
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="ui-count">
            {visible.length} de {schedules.length}{' '}
            {schedules.length === 1 ? 'registro' : 'registros'}
          </p>
        </>
      )}
    </section>
  );
}
