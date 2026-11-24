import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { validateNewMember } from './types';
import type { NewMemberErrors, NewMemberInput } from './types';
import './members.css';

interface Props {
  onSubmit: (input: NewMemberInput) => Promise<void>;
  onCancel: () => void;
}

export function NewMemberForm({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<NewMemberErrors>({});
  const [saving, setSaving] = useState(false);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateNewMember(name, email);
    setErrors(found);
    if (found.name || found.email) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim() });
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
