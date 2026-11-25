import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  MAX_WORK_PERIODS,
  formatMinute,
  parseMinute,
  validateWorkPeriods,
  workMinutes,
} from '@diovanibmotta/plantao365-shared';
import type { WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import { SCHEDULE_ADMIN_PATH, tabPath } from './paths';
import { describe } from './types';
import { formatDuration } from './WorkHoursList';

/** Edição da jornada de trabalho do time (rota própria, separada da listagem). */
export function WorkHoursForm() {
  const navigate = useNavigate();
  const [periods, setPeriods] = useState<WorkPeriod[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ periods: WorkPeriod[] }>('/api/work-hours', controller.signal)
      .then((r) => setPeriods(r.periods))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describe(err, 'Não foi possível carregar a jornada.'));
        }
      });
    return () => controller.abort();
  }, []);

  const back = () => void navigate(tabPath('work-hours'));

  const change = (next: (list: WorkPeriod[]) => WorkPeriod[]) => {
    setProblem(null);
    setPeriods((list) => list && next(list));
  };

  const update = (index: number, key: keyof WorkPeriod, text: string) => {
    const value = parseMinute(text);
    if (value === null) return;
    change((list) => list.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  };

  const add = () =>
    change((list) => {
      const start = Math.min((list.at(-1)?.endMinute ?? 480) + 60, 1380);
      return [...list, { startMinute: start, endMinute: Math.min(start + 240, 1440) }];
    });

  const save = async () => {
    if (!periods) return;
    const invalid = validateWorkPeriods(periods);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setBusy(true);
    try {
      await api.put<{ periods: WorkPeriod[] }>(
        '/api/work-hours',
        { periods },
        { successMessage: 'Jornada salva.' },
      );
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const crumbs = [
    { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
    { label: 'Jornada de trabalho', to: tabPath('work-hours') },
    { label: 'Editar' },
  ];

  if (loadError) {
    return (
      <FormPage crumbs={crumbs} title="Jornada de trabalho" onSubmit={back}>
        <p className="alert" role="alert">
          {loadError}
        </p>
      </FormPage>
    );
  }
  if (!periods) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  return (
    <FormPage
      crumbs={crumbs}
      title="Editar jornada de trabalho"
      description="Períodos em que todo o time está trabalhando."
      onSubmit={() => void save()}
    >
      <FormSection
        title="Períodos"
        description={
          periods.length === 0
            ? 'Sem jornada definida.'
            : `Total: ${formatDuration(workMinutes(periods))} por dia útil.`
        }
      >
        <ul className="sad-periods">
          {periods.map((p, i) => (
            <li key={i} className="sad-row">
              <label className="ui-field">
                Início do período {i + 1}
                <input
                  type="time"
                  value={formatMinute(p.startMinute)}
                  onChange={(e) => update(i, 'startMinute', e.target.value)}
                />
              </label>
              <label className="ui-field">
                Fim do período {i + 1}
                <input
                  type="time"
                  value={formatMinute(p.endMinute === 1440 ? 1439 : p.endMinute)}
                  onChange={(e) => update(i, 'endMinute', e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => change((list) => list.filter((_, idx) => idx !== i))}
              >
                Remover período {i + 1}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="btn"
              onClick={add}
              disabled={periods.length >= MAX_WORK_PERIODS}
            >
              Adicionar período
            </button>
          </li>
        </ul>
      </FormSection>
      {problem && (
        <p className="alert" role="alert">
          {problem}
        </p>
      )}
      <FormActions busy={busy} onCancel={back} />
    </FormPage>
  );
}
