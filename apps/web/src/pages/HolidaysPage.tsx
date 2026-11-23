import { useEffect, useState } from 'react';
import { api } from '../api/client';
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
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<HolidayWarning[]>([]);
  const [confirmingRecalc, setConfirmingRecalc] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
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
    setFormError(null);
    setActionError(null);
    setRemovingId(null);
  }

  function finish(result: HolidayMutation) {
    setWarnings(result.warnings ?? []);
    setConfirmingRecalc(false);
    setRecalcError(null);
    setRecalcResult(null);
    setEditing(null);
    setReload((n) => n + 1);
  }

  async function save(values: HolidayFormValues) {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const result =
        editing.mode === 'create'
          ? await api.post<HolidayMutation>('/api/holidays', values)
          : await api.patch<HolidayMutation>(`/api/holidays/${editing.holiday.id}`, values);
      finish(result);
    } catch (err) {
      setFormError(errorMessage(err, 'Não foi possível salvar o feriado.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(holiday: Holiday) {
    setSaving(true);
    setActionError(null);
    try {
      const result = await api.delete<HolidayMutation>(`/api/holidays/${holiday.id}`);
      setRemovingId(null);
      finish(result);
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível remover o feriado.'));
    } finally {
      setSaving(false);
    }
  }

  async function recalculate() {
    setRecalculating(true);
    setRecalcError(null);
    try {
      const result = await api.post<RecalculateResult>('/api/holidays/recalculate', {
        dates: [...new Set(warnings.map((w) => w.date))],
      });
      setRecalcResult(recalcSummary(result.updated));
      setWarnings([]);
      setConfirmingRecalc(false);
    } catch (err) {
      setRecalcError(errorMessage(err, 'Não foi possível recalcular as horas.'));
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
        setRecalcError(null);
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
      <p className="holidays-hint muted">Feriado conta como plantão de 24h (08h às 08h).</p>

      <HolidayWarnings
        warnings={warnings}
        action={recalcAction}
        onDismiss={() => {
          setWarnings([]);
          setConfirmingRecalc(false);
          setRecalcError(null);
        }}
      />
      {recalcError && (
        <p className="alert" role="alert">
          {recalcError}
        </p>
      )}
      {recalcResult && (
        <p className="status" role="status" aria-label="Resultado do recálculo">
          {recalcResult}
        </p>
      )}

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
          error={formError}
          onSubmit={(values) => void save(values)}
          onCancel={() => openForm(null)}
        />
      )}

      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
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
                        setActionError(null);
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
