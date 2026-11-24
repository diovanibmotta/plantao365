import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { ROLE_LABELS, phoneToPayload, validatePhone } from './types';
import type { Profile } from './types';
import './profile.css';

interface Props {
  profile: Profile;
  onSaved: (profile: Profile) => void;
}

export function PersonalDataSection({ profile, onSaved }: Props) {
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [reminders, setReminders] = useState(profile.remindersEnabled);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const phoneId = useId();
  const phoneErrorId = `${phoneId}-error`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validatePhone(phone);
    setPhoneError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const saved = await api.patch<Profile>(
        '/api/me',
        { phone: phoneToPayload(phone), remindersEnabled: reminders },
        { successMessage: 'Perfil salvo.' },
      );
      onSaved(saved);
      setPhone(saved.phone ?? '');
      setReminders(saved.remindersEnabled);
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="profile-section" aria-labelledby={`${phoneId}-title`}>
      <h2 id={`${phoneId}-title`}>Dados pessoais</h2>
      <dl className="profile-facts">
        <dt>Nome</dt>
        <dd>{profile.name}</dd>
        <dt>E-mail</dt>
        <dd>{profile.email}</dd>
        <dt>Papel</dt>
        <dd>{ROLE_LABELS[profile.role]}</dd>
        <dt>Status</dt>
        <dd>{profile.active ? 'Ativo' : 'Inativo'}</dd>
      </dl>
      <p className="muted">
        Nome e e-mail vêm do Entra ID; o papel é definido pelo gestor. Você pode alterar apenas o
        telefone e as preferências abaixo.
      </p>
      <form className="profile-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="profile-field">
          <label htmlFor={phoneId}>Telefone (opcional)</label>
          <input
            id={phoneId}
            type="tel"
            autoComplete="tel"
            value={phone}
            aria-invalid={phoneError !== null}
            aria-describedby={phoneError ? phoneErrorId : undefined}
            onChange={(e) => setPhone(e.target.value)}
          />
          {phoneError && (
            <p id={phoneErrorId} className="profile-error">
              {phoneError}
            </p>
          )}
        </div>
        <label className="profile-check">
          <input
            type="checkbox"
            checked={reminders}
            onChange={(e) => setReminders(e.target.checked)}
          />
          Receber lembretes de plantão
        </label>
        <div>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </section>
  );
}
