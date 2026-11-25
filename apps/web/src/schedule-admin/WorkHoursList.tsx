import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatMinute, sortWorkPeriods, workMinutes } from '@diovanibmotta/plantao365-shared';
import type { WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';
import { WORK_HOURS_NEW_PATH, workHoursPath } from './paths';
import { describe } from './types';

export const formatDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;

/** Jornada de trabalho do time: um registro por período; cadastro e edição em rota própria. */
export function WorkHoursList() {
  const [periods, setPeriods] = useState<WorkPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                {periods.map((p, i) => (
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
          <p className="ui-count">
            {periods.length} {periods.length === 1 ? 'período' : 'períodos'} · Total:{' '}
            {formatDuration(workMinutes(periods))} por dia útil.
          </p>
        </>
      )}
    </section>
  );
}
