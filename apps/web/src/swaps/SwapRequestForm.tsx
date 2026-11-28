import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { addDays } from '@plantao365/shared';
import type { LocalDate } from '@plantao365/shared';
import { api } from '../api/client';
import { formatDayShort, formatPeriod } from '../schedule/format';
import type { ShiftDto } from '../schedule/types';
import { KIND_LABEL } from './types';
import type { SwapKind } from './types';
import './swaps.css';

const HORIZON_DAYS = 240;

interface Colleague {
  id: string;
  name: string;
}

interface Props {
  shift: ShiftDto;
  today: LocalDate;
  onClose: () => void;
  onDone: () => void;
}

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

async function loadColleagues(signal: AbortSignal): Promise<Colleague[]> {
  return api.get<Colleague[]>('/api/users/colleagues', signal);
}

export function SwapRequestForm({ shift, today, onClose, onDone }: Props) {
  const id = useId();
  const [kind, setKind] = useState<SwapKind>('swap');
  const [colleagues, setColleagues] = useState<Colleague[] | null>(null);
  const [colleagueId, setColleagueId] = useState('');
  const [theirShifts, setTheirShifts] = useState<ShiftDto[]>([]);
  const [theirShiftId, setTheirShiftId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadColleagues(controller.signal)
      .then(setColleagues)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setColleagues([]);
        setError(errorText(err, 'Não foi possível carregar os colegas.'));
      });
    return () => controller.abort();
  }, [shift, today]);

  useEffect(() => {
    if (kind !== 'swap' || colleagueId === '') return;
    const controller = new AbortController();
    const to = addDays(today, HORIZON_DAYS);
    api
      .get<ShiftDto[]>(
        `/api/shifts?from=${today}&to=${to}&userId=${colleagueId}`,
        controller.signal,
      )
      .then((list) =>
        setTheirShifts(list.filter((s) => s.userId === colleagueId && s.date >= today)),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setTheirShifts([]);
        setError(errorText(err, 'Não foi possível carregar os plantões do colega.'));
      });
    return () => controller.abort();
  }, [kind, colleagueId, today]);

  const pickColleague = (value: string) => {
    setColleagueId(value);
    setTheirShifts([]);
    setTheirShiftId('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (colleagueId === '') return setError('Escolha o colega.');
    if (kind === 'swap' && theirShiftId === '') return setError('Escolha o plantão do colega.');
    setSaving(true);
    try {
      await api.post(
        '/api/swaps',
        {
          kind,
          shiftId: shift.id,
          counterpartId: colleagueId,
          ...(kind === 'swap' ? { counterpartShiftId: theirShiftId } : {}),
          ...(note.trim() !== '' ? { note: note.trim() } : {}),
        },
        { successMessage: 'Solicitação registrada.' },
      );
      onDone();
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="swp-form"
      aria-label="Solicitar troca"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="swp-field">
        <label htmlFor={`${id}-kind`}>Tipo</label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as SwapKind)}
        >
          <option value="swap">{KIND_LABEL.swap} (troca de plantões)</option>
          <option value="cession">{KIND_LABEL.cession} (o colega assume o plantão)</option>
        </select>
      </div>
      <div className="swp-field">
        <label htmlFor={`${id}-colleague`}>Colega</label>
        <select
          id={`${id}-colleague`}
          value={colleagueId}
          disabled={colleagues === null}
          onChange={(e) => pickColleague(e.target.value)}
        >
          <option value="">Selecione…</option>
          {(colleagues ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {kind === 'swap' && (
        <div className="swp-field">
          <label htmlFor={`${id}-theirs`}>Plantão do colega</label>
          <select
            id={`${id}-theirs`}
            value={theirShiftId}
            disabled={colleagueId === ''}
            onChange={(e) => setTheirShiftId(e.target.value)}
          >
            <option value="">Selecione…</option>
            {theirShifts.map((s) => (
              <option key={s.id} value={s.id}>
                {formatDayShort(s.date)} · {formatPeriod(s)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="swp-field">
        <label htmlFor={`${id}-note`}>Observação (opcional)</label>
        <textarea
          id={`${id}-note`}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="swp-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          Enviar solicitação
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
