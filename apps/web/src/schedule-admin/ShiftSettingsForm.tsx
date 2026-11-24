import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { SHIFT_DAY_TYPES, shiftDuration } from '@diovanibmotta/plantao365-shared';
import type { ShiftDayType, ShiftTimes } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { DAY_TYPE_LABEL, formatHours } from '../schedule/format';
import { describe } from './types';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Horário do plantão por tipo de dia; vale para os próximos rascunhos gerados. */
export function ShiftSettingsForm() {
  const [times, setTimes] = useState<ShiftTimes | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ShiftTimes>('/api/shift-settings', controller.signal)
      .then(setTimes)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describe(err, 'Não foi possível carregar os horários.'));
        }
      });
    return () => controller.abort();
  }, []);

  const set = (type: ShiftDayType, key: 'startHour' | 'endHour', value: number) => {
    setTimes((t) => t && { ...t, [type]: { ...t[type], [key]: value } });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!times) return;
    setBusy(true);
    try {
      setTimes(
        await api.put<ShiftTimes>('/api/shift-settings', times, {
          successMessage: 'Horários salvos. Valem para os próximos rascunhos gerados.',
        }),
      );
    } catch {
      // erro exibido pelo toast
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="sad-times-title" className="sad-block">
      <h2 id="sad-times-title">Horário dos plantões</h2>
      {times === null && !loadError && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {times && (
        <form onSubmit={(e) => void submit(e)}>
          <table className="sad-table">
            <thead>
              <tr>
                <th scope="col">Tipo de dia</th>
                <th scope="col">Início</th>
                <th scope="col">Fim</th>
                <th scope="col">Duração</th>
              </tr>
            </thead>
            <tbody>
              {SHIFT_DAY_TYPES.map((type) => {
                const t = times[type];
                const nextDay = t.endHour <= t.startHour;
                return (
                  <tr key={type}>
                    <th scope="row">{DAY_TYPE_LABEL[type]}</th>
                    {(['startHour', 'endHour'] as const).map((key) => (
                      <td key={key}>
                        <select
                          aria-label={`${key === 'startHour' ? 'Início' : 'Fim'} — ${DAY_TYPE_LABEL[type]}`}
                          value={t[key]}
                          onChange={(e) => set(type, key, Number(e.target.value))}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h}>
                              {hh(h)}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      {formatHours(shiftDuration(t))}
                      {nextDay && <span className="muted"> (termina no dia seguinte)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">Fim menor ou igual ao início termina no dia seguinte.</p>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar horários'}
          </button>
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
