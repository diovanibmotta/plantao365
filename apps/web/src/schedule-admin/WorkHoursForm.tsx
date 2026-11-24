import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  MAX_WORK_PERIODS,
  formatMinute,
  parseMinute,
  validateWorkPeriods,
  workMinutes,
} from '@diovanibmotta/plantao365-shared';
import type { WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { toast } from '../toast/toast-store';
import { describe } from './types';

/** Jornada de trabalho do time (ex.: 08:00–12:00 | 13:30–18:00), exibida no calendário. */
export function WorkHoursForm() {
  const [periods, setPeriods] = useState<WorkPeriod[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const update = (index: number, key: keyof WorkPeriod, text: string) => {
    const value = parseMinute(text);
    if (value === null) return;
    setPeriods((list) => list && list.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  };

  const add = () => {
    setPeriods((list) => {
      const last = list?.at(-1)?.endMinute ?? 480;
      const start = Math.min(last + 60, 1380);
      return [...(list ?? []), { startMinute: start, endMinute: Math.min(start + 240, 1440) }];
    });
  };

  const remove = (index: number) => {
    setPeriods((list) => list && list.filter((_, i) => i !== index));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!periods) return;
    const problem = validateWorkPeriods(periods);
    if (problem) {
      toast.warning(problem);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.put<{ periods: WorkPeriod[] }>(
        '/api/work-hours',
        { periods },
        { successMessage: 'Jornada salva.' },
      );
      setPeriods(saved.periods);
    } catch {
      // erro exibido pelo toast
    } finally {
      setBusy(false);
    }
  };

  const total = periods ? workMinutes(periods) : 0;

  return (
    <section aria-labelledby="sad-work-title" className="sad-block">
      <h2 id="sad-work-title">Jornada de trabalho</h2>
      <p className="muted">
        Períodos em que todo o time está trabalhando. Aparecem destacados nas visões de dia e semana
        do calendário.
      </p>
      {periods === null && !loadError && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {periods && (
        <form onSubmit={(e) => void submit(e)}>
          <ul className="sad-periods">
            {periods.map((p, i) => (
              <li key={i} className="sad-row">
                <label>
                  Início do período {i + 1}
                  <input
                    type="time"
                    value={formatMinute(p.startMinute)}
                    onChange={(e) => update(i, 'startMinute', e.target.value)}
                  />
                </label>
                <label>
                  Fim do período {i + 1}
                  <input
                    type="time"
                    value={formatMinute(p.endMinute === 1440 ? 1439 : p.endMinute)}
                    onChange={(e) => update(i, 'endMinute', e.target.value)}
                  />
                </label>
                <button type="button" className="btn" onClick={() => remove(i)}>
                  Remover período {i + 1}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">
            {periods.length === 0
              ? 'Sem jornada definida.'
              : `Total: ${Math.floor(total / 60)}h${total % 60 ? String(total % 60).padStart(2, '0') : ''} por dia útil.`}
          </p>
          <div className="sad-row">
            <button
              type="button"
              className="btn"
              onClick={add}
              disabled={periods.length >= MAX_WORK_PERIODS}
            >
              Adicionar período
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar jornada'}
            </button>
          </div>
        </form>
      )}
      {loadError && (
        <p className="alert" role="alert">
          {loadError}
        </p>
      )}
    </section>
  );
}
