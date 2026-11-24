import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ApiError } from '../api/client';
import { toast } from '../toast/toast-store';
import { HolidayForm } from '../holidays/HolidayForm';
import { HolidayWarnings } from '../holidays/HolidayWarnings';
import {
  EMPTY_FORM,
  errorMessage,
  formatHolidayDate,
  scopeLabel,
  recalcSummary,
  yearOptions,
} from '../holidays/types';
import type {
  Holiday,
  HolidayFormValues,
  HolidayMutation,
  HolidayWarning,
  RecalculateResult,
} from '../holidays/types';
import '../holidays/holidays.css';

const saveError = (err: ApiError) => errorMessage(err, 'Não foi possível concluir a operação.');

type Outcome = { error: string } | { items: Holiday[] };

interface Loaded {
  key: string;
  outcome: Outcome;
}

type Editing = { mode: 'create' } | { mode: 'edit'; holiday: Holiday } | null;

export function HolidaysPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<HolidayWarning[]>([]);
  const [confirmingRecalc, setConfirmingRecalc] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const key = `${year}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ items: Holiday[] }>(`/api/holidays?year=${year}`, controller.signal)
      .then((data) => setLoaded({ key, outcome: { items: data.items } }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          key,
          outcome: { error: errorMessage(err, 'Não foi possível carregar os feriados.') },
        });
      });
    return () => controller.abort();
  }, [year, key]);

  const outcome = loaded?.key === key ? loaded.outcome : null;

  function openForm(next: Editing) {
    setEditing(next);
    setRemovingId(null);
  }

  function finish(result: HolidayMutation) {
    setWarnings(result.warnings ?? []);
    setConfirmingRecalc(false);
    setEditing(null);
    setReload((n) => n + 1);
  }

  async function save(values: HolidayFormValues) {
    if (!editing) return;
    setSaving(true);
    try {
      const result =
        editing.mode === 'create'
          ? await api.post<HolidayMutation>('/api/holidays', values, {
              successMessage: 'Feriado criado.',
              errorMessage: saveError,
            })
          : await api.patch<HolidayMutation>(`/api/holidays/${editing.holiday.id}`, values, {
              successMessage: 'Feriado salvo.',
              errorMessage: saveError,
            });
      finish(result);
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  }

  async function remove(holiday: Holiday) {
    setSaving(true);
    try {
      const result = await api.delete<HolidayMutation>(`/api/holidays/${holiday.id}`, {
        successMessage: 'Feriado removido.',
        errorMessage: saveError,
      });
      setRemovingId(null);
      finish(result);
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  }

  async function recalculate() {
    setRecalculating(true);
    try {
      const result = await api.post<RecalculateResult>(
        '/api/holidays/recalculate',
        { dates: [...new Set(warnings.map((w) => w.date))] },
        { silentSuccess: true },
      );
      toast.success(recalcSummary(result.updated));
      setWarnings([]);
      setConfirmingRecalc(false);
    } catch {
      // erro exibido pelo toast
    } finally {
      setRecalculating(false);
    }
  }

  const recalcAction = confirmingRecalc ? (
    <span className="holidays-confirm" role="group" aria-label="Confirmar recálculo">
      <span>Recalcular as horas dos plantões publicados nessas datas?</span>
      <button
        type="button"
        className="btn primary"
        disabled={recalculating}
        onClick={() => void recalculate()}
      >
        {recalculating ? 'Recalculando…' : 'Confirmar recálculo'}
      </button>
      <button
        type="button"
        className="btn"
        disabled={recalculating}
        onClick={() => setConfirmingRecalc(false)}
      >
        Cancelar
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="btn primary"
      onClick={() => {
        setConfirmingRecalc(true);
      }}
    >
      Recalcular horas
    </button>
  );

  const years = yearOptions(year, currentYear);

  return (
    <section>
      <div className="holidays-header">
        <h1>Feriados</h1>
        <label className="holidays-year">
          Ano
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={editing !== null}
          onClick={() => openForm({ mode: 'create' })}
        >
          Novo feriado
        </button>
      </div>
      <p className="holidays-hint muted">Feriado conta como plantão de 24h (08:00 às 08:00).</p>

      <HolidayWarnings
        warnings={warnings}
        action={recalcAction}
        onDismiss={() => {
          setWarnings([]);
          setConfirmingRecalc(false);
        }}
      />

      {editing && (
        <HolidayForm
          key={editing.mode === 'edit' ? editing.holiday.id : 'new'}
          title={editing.mode === 'create' ? 'Novo feriado' : 'Editar feriado'}
          initial={
            editing.mode === 'edit'
              ? {
                  date: editing.holiday.date,
                  name: editing.holiday.name,
                  scope: editing.holiday.scope,
                }
              : EMPTY_FORM
          }
          saving={saving}
          onSubmit={(values) => void save(values)}
          onCancel={() => openForm(null)}
        />
      )}

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
      {outcome !== null && 'items' in outcome && outcome.items.length === 0 && (
        <p className="status muted">Nenhum feriado cadastrado em {year}.</p>
      )}
      {outcome !== null && 'items' in outcome && outcome.items.length > 0 && (
        <ul className="holidays-list" aria-label={`Feriados de ${year}`}>
          {[...outcome.items]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((h) => (
              <li key={h.id} className="holidays-item">
                <div className="holidays-info">
                  <span className="holidays-date">{formatHolidayDate(h.date)}</span>
                  <span>
                    {h.name}
                    <span className="holidays-scope">{scopeLabel(h.scope)}</span>
                  </span>
                </div>
                {removingId === h.id ? (
                  <div className="holidays-confirm" role="group" aria-label={`Remover ${h.name}`}>
                    <span>Remover “{h.name}”?</span>
                    <button
                      type="button"
                      className="btn holidays-danger"
                      disabled={saving}
                      onClick={() => void remove(h)}
                    >
                      Confirmar remoção
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => setRemovingId(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="holidays-row-actions">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Editar ${h.name}`}
                      onClick={() => openForm({ mode: 'edit', holiday: h })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Remover ${h.name}`}
                      onClick={() => {
                        setEditing(null);
                        setRemovingId(h.id);
                      }}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
