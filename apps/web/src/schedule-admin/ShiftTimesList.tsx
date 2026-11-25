import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { shiftDuration } from '@diovanibmotta/plantao365-shared';
import type { ShiftTimes, WeekdayShiftTime } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { formatHours } from '../schedule/format';
import { PageHeader } from '../ui/PageHeader';
import { SHIFT_TIMES_NEW_PATH, shiftTimePath } from './paths';
import { describe } from './types';
import { SHIFT_TARGETS, effectiveTime, targetLabel } from './weekdays';

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Horário do plantão: um registro por dia da semana (segunda a domingo) e um para feriado. */
export function ShiftTimesList() {
  const [times, setTimes] = useState<ShiftTimes | null>(null);
  const [weekdays, setWeekdays] = useState<WeekdayShiftTime[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fail = (err: unknown) => {
      if (!controller.signal.aborted) {
        setError(describe(err, 'Não foi possível carregar os horários.'));
      }
    };
    api.get<ShiftTimes>('/api/shift-settings', controller.signal).then(setTimes).catch(fail);
    api
      .get<WeekdayShiftTime[]>('/api/shift-weekday-times', controller.signal)
      .then(setWeekdays)
      .catch(fail);
    return () => controller.abort();
  }, []);

  const rows = useMemo(
    () =>
      times && weekdays
        ? SHIFT_TARGETS.map((target) => ({
            target,
            label: targetLabel(target),
            ...effectiveTime(target, times, weekdays),
          }))
        : [],
    [times, weekdays],
  );

  return (
    <section className="sad-block">
      <PageHeader
        title="Horários dos plantões"
        description="Horário do plantão de cada dia da semana e de feriado. Valem para os próximos rascunhos gerados."
        action={
          <Link to={SHIFT_TIMES_NEW_PATH} className="btn primary">
            Novo horário
          </Link>
        }
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {!error && (times === null || weekdays === null) && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {rows.length > 0 && (
        <div className="ui-table-wrap">
          <table className="ui-table" aria-label="Horários dos plantões">
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Início</th>
                <th scope="col">Fim</th>
                <th scope="col">Duração</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.target}>
                  <th scope="row">
                    {r.label}
                    {!r.custom && <span className="ui-tag"> padrão</span>}
                  </th>
                  <td>{hh(r.time.startHour)}</td>
                  <td>{hh(r.time.endHour)}</td>
                  <td>
                    {formatHours(shiftDuration(r.time))}
                    {r.time.endHour <= r.time.startHour && (
                      <span className="muted"> (termina no dia seguinte)</span>
                    )}
                  </td>
                  <td className="ui-col-actions">
                    <Link
                      to={shiftTimePath(r.target)}
                      className="btn sm"
                      aria-label={`Editar horário de ${r.label}`}
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
    </section>
  );
}
