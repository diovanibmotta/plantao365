import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { toast } from '../toast/toast-store';
import { MAX_CONSECUTIVE, WEEKDAYS, errorMessage } from './types';
import './exceptions.css';

interface Preferences {
  avoidWeekdays: number[];
  maxConsecutiveShifts: number | null;
}

export function PreferencesSection() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [max, setMax] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ preferences: Preferences }>('/api/me/preferences', controller.signal)
      .then(({ preferences }) => {
        setDays(preferences.avoidWeekdays);
        setMax(
          preferences.maxConsecutiveShifts === null ? '' : String(preferences.maxConsecutiveShifts),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(err, 'Não foi possível carregar as preferências.'));
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function toggle(day: number) {
    setDays((cur) =>
      cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort((a, b) => a - b),
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = max.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > MAX_CONSECUTIVE)) {
      toast.warning(`O máximo de plantões consecutivos deve estar entre 1 e ${MAX_CONSECUTIVE}.`);
      return;
    }
    setSaving(true);
    try {
      await api.put(
        '/api/me/preferences',
        { avoidWeekdays: days, maxConsecutiveShifts: value },
        { successMessage: 'Preferências salvas.' },
      );
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  if (loadError) {
    return (
      <p className="alert" role="alert">
        {loadError}
      </p>
    );
  }

  return (
    <section className="exc-section">
      <h2>Preferências</h2>
      <p className="muted">
        São desejos, não garantias: o rodízio tenta atendê-los quando possível.
      </p>
      <form
        className="exc-form"
        onSubmit={(e) => void submit(e)}
        aria-label="Preferências"
        noValidate
      >
        <fieldset className="exc-fieldset">
          <legend>Dias da semana a evitar</legend>
          {WEEKDAYS.map((name, day) => (
            <label key={name} className="exc-check">
              <input type="checkbox" checked={days.includes(day)} onChange={() => toggle(day)} />
              {name}
            </label>
          ))}
        </fieldset>
        <label>
          Máximo de plantões consecutivos (vazio = sem preferência)
          <input
            type="number"
            min={1}
            max={MAX_CONSECUTIVE}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
        <div className="exc-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </section>
  );
}
