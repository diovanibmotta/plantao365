import { useState } from 'react';
import type { FormEvent } from 'react';
import { KIND_OPTIONS, validatePeriod } from './types';
import type { ExceptionKind, FormValues, MemberOption } from './types';

interface Props {
  title: string;
  withKind: boolean;
  members: MemberOption[] | null;
  selfId: string;
  initial: FormValues | null;
  saving: boolean;
  error: string | null;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
}

export function UnavailabilityForm({
  title,
  withKind,
  members,
  selfId,
  initial,
  saving,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [kind, setKind] = useState<ExceptionKind>(initial?.kind ?? 'vacation');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [userId, setUserId] = useState(initial?.userId ?? selfId);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validatePeriod(startDate, endDate);
    setFieldError(problem);
    if (problem) return;
    onSubmit({ kind, startDate, endDate, note, userId });
  }

  const message = fieldError ?? error;

  return (
    <form className="exc-form" onSubmit={submit} aria-label={title} noValidate>
      {members && (
        <label>
          Membro
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {withKind && (
        <label>
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value as ExceptionKind)}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Data inicial
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <label>
        Data final
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <label>
        Observação (opcional)
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {message && (
        <p className="alert" role="alert">
          {message}
        </p>
      )}
      <div className="exc-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
