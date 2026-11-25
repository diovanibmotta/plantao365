import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  DEFAULT_WORK_PERIODS,
  MAX_WORK_PERIODS,
  formatMinute,
  parseMinute,
  shiftDuration,
  validateWorkPeriods,
} from '@diovanibmotta/plantao365-shared';
import type { ShiftException, WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { formatHours } from '../schedule/format';
import { describe, formatDate } from './types';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const periodsText = (periods: readonly WorkPeriod[]) =>
  periods.map((p) => `${formatMinute(p.startMinute)}–${formatMinute(p.endMinute)}`).join(' | ');

interface Draft {
  date: string;
  startHour: number;
  endHour: number;
  customWork: boolean;
  workPeriods: WorkPeriod[];
  note: string;
}

const emptyDraft = (workPeriods: readonly WorkPeriod[]): Draft => ({
  date: '',
  startHour: 15,
  endHour: 8,
  customWork: true,
  workPeriods: workPeriods.map((p) => ({ ...p })),
  note: '',
});

/** Datas com horário de plantão (e jornada) diferente do padrão, ex.: 24/12 e 31/12. */
export function ShiftExceptionsForm() {
  const [items, setItems] = useState<ShiftException[] | null>(null);
  const [teamWork, setTeamWork] = useState<readonly WorkPeriod[]>(DEFAULT_WORK_PERIODS);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(DEFAULT_WORK_PERIODS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setItems(await api.get<ShiftException[]>('/api/shift-exceptions', signal));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const fail = (err: unknown, fallback: string) => {
      if (!controller.signal.aborted) setMessage({ ok: false, text: describe(err, fallback) });
    };
    api
      .get<ShiftException[]>('/api/shift-exceptions', controller.signal)
      .then(setItems)
      .catch((err: unknown) => fail(err, 'Não foi possível carregar as exceções.'));
    api
      .get<{ periods: WorkPeriod[] }>('/api/work-hours', controller.signal)
      .then((r) => {
        setTeamWork(r.periods);
        setDraft((d) => (d.date ? d : emptyDraft(r.periods)));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const patch = (p: Partial<Draft>) => {
    setMessage(null);
    setDraft((d) => ({ ...d, ...p }));
  };

  const updatePeriod = (index: number, key: keyof WorkPeriod, text: string) => {
    const value = parseMinute(text);
    if (value === null) return;
    patch({
      workPeriods: draft.workPeriods.map((p, i) => (i === index ? { ...p, [key]: value } : p)),
    });
  };

  const edit = (e: ShiftException) => {
    setMessage(null);
    setDraft({
      date: e.date,
      startHour: e.startHour,
      endHour: e.endHour,
      customWork: e.workPeriods !== null,
      workPeriods: (e.workPeriods ?? teamWork).map((p) => ({ ...p })),
      note: e.note ?? '',
    });
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!draft.date) {
      setMessage({ ok: false, text: 'Informe a data.' });
      return;
    }
    const problem = draft.customWork ? validateWorkPeriods(draft.workPeriods) : null;
    if (problem) {
      setMessage({ ok: false, text: problem });
      return;
    }
    setBusy(true);
    try {
      await api.put<ShiftException>(
        `/api/shift-exceptions/${draft.date}`,
        {
          startHour: draft.startHour,
          endHour: draft.endHour,
          workPeriods: draft.customWork ? draft.workPeriods : null,
          note: draft.note.trim() || null,
        },
        { successMessage: 'Exceção salva. Vale para as próximas escalas geradas.' },
      );
      await load();
      setDraft(emptyDraft(teamWork));
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const remove = async (date: string) => {
    setBusy(true);
    try {
      await api.delete(`/api/shift-exceptions/${date}`, { successMessage: 'Exceção removida.' });
      await load();
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const nextDay = draft.endHour <= draft.startHour;

  return (
    <section aria-labelledby="sad-exc-title" className="sad-block">
      <h2 id="sad-exc-title">Exceções por data</h2>
      <p className="muted">
        Datas com jornada e plantão diferentes do padrão, como 24/12 e 31/12. Na geração da escala,
        o plantão dessas datas usa o horário da exceção.
      </p>
      {items === null && !message && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {items?.length === 0 && <p className="muted">Nenhuma exceção cadastrada.</p>}
      {items && items.length > 0 && (
        <table className="sad-table" aria-label="Exceções de horário">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Plantão</th>
              <th scope="col">Jornada</th>
              <th scope="col">Observação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.date}>
                <td>{formatDate(e.date)}</td>
                <td>
                  {hh(e.startHour)}–{hh(e.endHour)} (
                  {formatHours(shiftDuration({ startHour: e.startHour, endHour: e.endHour }))})
                </td>
                <td>{e.workPeriods ? periodsText(e.workPeriods) || 'Sem jornada' : 'Padrão'}</td>
                <td>{e.note ?? ''}</td>
                <td className="sad-actions">
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Editar exceção de ${formatDate(e.date)}`}
                    onClick={() => edit(e)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    aria-label={`Remover exceção de ${formatDate(e.date)}`}
                    onClick={() => void remove(e.date)}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={(ev) => void submit(ev)}>
        <div className="sad-row">
          <label>
            Data
            <input
              type="date"
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </label>
          <label>
            Início do plantão
            <select
              value={draft.startHour}
              onChange={(e) => patch({ startHour: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fim do plantão
            <select
              value={draft.endHour}
              onChange={(e) => patch({ endHour: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Observação
            <input
              type="text"
              maxLength={120}
              value={draft.note}
              placeholder="Ex.: Véspera de Natal"
              onChange={(e) => patch({ note: e.target.value })}
            />
          </label>
        </div>
        <p className="muted">
          Duração: {formatHours(shiftDuration(draft))}
          {nextDay && ' (termina no dia seguinte)'}
        </p>
        <label>
          <input
            type="checkbox"
            checked={draft.customWork}
            onChange={(e) => patch({ customWork: e.target.checked })}
          />{' '}
          Jornada de trabalho diferente neste dia
        </label>
        {draft.customWork && (
          <ul className="sad-periods">
            {draft.workPeriods.map((p, i) => (
              <li key={i} className="sad-row">
                <label>
                  Início do período {i + 1}
                  <input
                    type="time"
                    value={formatMinute(p.startMinute)}
                    onChange={(e) => updatePeriod(i, 'startMinute', e.target.value)}
                  />
                </label>
                <label>
                  Fim do período {i + 1}
                  <input
                    type="time"
                    value={formatMinute(p.endMinute === 1440 ? 1439 : p.endMinute)}
                    onChange={(e) => updatePeriod(i, 'endMinute', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    patch({ workPeriods: draft.workPeriods.filter((_, idx) => idx !== i) })
                  }
                >
                  Remover período {i + 1}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="btn"
                disabled={draft.workPeriods.length >= MAX_WORK_PERIODS}
                onClick={() => {
                  const start = Math.min((draft.workPeriods.at(-1)?.endMinute ?? 480) + 60, 1380);
                  patch({
                    workPeriods: [
                      ...draft.workPeriods,
                      { startMinute: start, endMinute: Math.min(start + 120, 1440) },
                    ],
                  });
                }}
              >
                Adicionar período
              </button>
            </li>
          </ul>
        )}
        <div className="sad-row">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar exceção'}
          </button>
        </div>
      </form>
      {message && (
        <p className={message.ok ? 'status' : 'alert'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
