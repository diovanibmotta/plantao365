import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { defaultParticipates, ROLE_OPTIONS, validateNewMember } from './types';
import type { MemberRole, NewMemberErrors, NewMemberInput } from './types';
import './members.css';

interface Props {
  onSubmit: (input: NewMemberInput) => Promise<void>;
  onCancel: () => void;
  serverError: string | null;
}

export function NewMemberForm({ onSubmit, onCancel, serverError }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [participates, setParticipates] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<NewMemberErrors>({});
  const [saving, setSaving] = useState(false);
  const id = useId();
  const effective = participates ?? defaultParticipates(role);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateNewMember(name, email);
    setErrors(found);
    if (found.name || found.email) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        email: email.trim(),
        role,
        participatesInRotation: effective,
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
      <div className="members-field">
        <label htmlFor={`${id}-role`}>Papel</label>
        <select
          id={`${id}-role`}
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <label className="members-check">
        <input
          type="checkbox"
          checked={effective}
          onChange={(e) => setParticipates(e.target.checked)}
        />
        Participa do rodízio
      </label>
      {serverError && (
        <p className="alert" role="alert">
          {serverError}
        </p>
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
