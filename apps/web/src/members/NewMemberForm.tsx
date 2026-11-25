import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useManageableTeams } from '../team/TeamContext';
import { ROLE_OPTIONS, validateNewMember } from './types';
import type { NewMemberErrors, NewMemberInput, TeamRole } from './types';
import './members.css';

interface TeamPick {
  role: TeamRole;
  participatesInRotation: boolean;
}

interface Props {
  onSubmit: (input: NewMemberInput) => Promise<void>;
  onCancel: () => void;
}

export function NewMemberForm({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<NewMemberErrors>({});
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<Record<string, TeamPick>>({});
  const manageable = useManageableTeams();
  const id = useId();

  const toggleTeam = (teamId: string, on: boolean) =>
    setPicked((prev) => {
      const rest = { ...prev };
      delete rest[teamId];
      return on ? { ...rest, [teamId]: { role: 'member', participatesInRotation: true } } : rest;
    });

  const patchTeam = (teamId: string, patch: Partial<TeamPick>) =>
    setPicked((prev) => ({ ...prev, [teamId]: { ...prev[teamId]!, ...patch } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateNewMember(name, email);
    setErrors(found);
    if (found.name || found.email) return;
    setSaving(true);
    try {
      const teams = manageable
        .filter((t) => picked[t.id])
        .map((t) => ({ teamId: t.id, ...picked[t.id]! }));
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        ...(teams.length ? { teams } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="members-form"
      aria-label="Pré-cadastro de membro"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="members-field">
        <label htmlFor={`${id}-name`}>Nome</label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="off"
          value={name}
          aria-invalid={errors.name !== undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name && <p className="members-error">{errors.name}</p>}
      </div>
      <div className="members-field">
        <label htmlFor={`${id}-email`}>E-mail</label>
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="off"
          value={email}
          aria-invalid={errors.email !== undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {errors.email && <p className="members-error">{errors.email}</p>}
      </div>
      {manageable.length > 0 && (
        <fieldset className="members-teams">
          <legend>Equipes (opcional)</legend>
          <p className="muted">
            Vincule agora para que, no primeiro acesso, a pessoa já entre com o papel da equipe.
          </p>
          {manageable.map((t) => {
            const pick = picked[t.id];
            return (
              <div key={t.id} className="members-team-row">
                <label className="members-check">
                  <input
                    type="checkbox"
                    aria-label={`Vincular a ${t.name}`}
                    checked={pick !== undefined}
                    onChange={(e) => toggleTeam(t.id, e.target.checked)}
                  />
                  {t.name}
                </label>
                {pick && (
                  <>
                    <select
                      aria-label={`Papel em ${t.name}`}
                      value={pick.role}
                      onChange={(e) => {
                        const role = e.target.value as TeamRole;
                        patchTeam(t.id, { role, participatesInRotation: role === 'member' });
                      }}
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <label className="members-check">
                      <input
                        type="checkbox"
                        aria-label={`Participa do rodízio em ${t.name}`}
                        checked={pick.participatesInRotation}
                        onChange={(e) =>
                          patchTeam(t.id, { participatesInRotation: e.target.checked })
                        }
                      />
                      Rodízio
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      <div className="members-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Pré-cadastrar'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
