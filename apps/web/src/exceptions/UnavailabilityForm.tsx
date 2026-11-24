import { useState } from 'react';
import type { FormEvent } from 'react';
import { KIND_OPTIONS, validatePeriod } from './types';
import type { ExceptionKind, FormValues, MemberOption } from './types';

interface Props {
  title: string;
  withKind: boolean;
  /** Tela de Férias: oferece Individual/Coletiva (só ao criar). */
  withScope: boolean;
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
  withScope,
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
  const [collective, setCollective] = useState(initial?.collective ?? false);
  const [allTeam, setAllTeam] = useState(initial?.allTeam ?? true);
  const [userIds, setUserIds] = useState<string[]>(initial?.userIds ?? []);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const activeMembers = (members ?? []).filter((m) => m.active);
  const picking = withScope && collective && !allTeam;

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem =
      validatePeriod(startDate, endDate) ??
      (picking && userIds.length === 0 ? 'Selecione ao menos um membro.' : null);
    setFieldError(problem);
    if (problem) return;
    onSubmit({ kind, startDate, endDate, note, userId, collective, allTeam, userIds });
  }

  function toggle(id: string) {
    setUserIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const message = fieldError ?? error;

  return (
    <form className="exc-form" onSubmit={submit} aria-label={title} noValidate>
      {withScope && members && (
        <label>
          Tipo de férias
          <select
            value={collective ? 'collective' : 'individual'}
            onChange={(e) => setCollective(e.target.value === 'collective')}
          >
            <option value="individual">Individual</option>
            <option value="collective">Coletiva</option>
          </select>
        </label>
      )}
      {members && !(withScope && collective) && (
        <label>
          Membro
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {members && withScope && collective && (
        <fieldset className="exc-fieldset">
          <legend>Quem entra de férias</legend>
          <label className="exc-check">
            <input type="radio" name="who" checked={allTeam} onChange={() => setAllTeam(true)} />
            Todo o time
          </label>
          <label className="exc-check">
            <input type="radio" name="who" checked={!allTeam} onChange={() => setAllTeam(false)} />
            Membros específicos
          </label>
          {!allTeam && (
            <ul aria-label="Membros em férias">
              {activeMembers.map((m) => (
                <li key={m.id}>
                  <label className="exc-check">
                    <input
                      type="checkbox"
                      checked={userIds.includes(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    {m.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
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
