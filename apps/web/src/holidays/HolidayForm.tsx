import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { SCOPES, validateForm } from './types';
import type { HolidayFormErrors, HolidayFormValues, HolidayScope } from './types';

interface Props {
  title: string;
  initial: HolidayFormValues;
  saving: boolean;
  onSubmit: (values: HolidayFormValues) => void;
  onCancel: () => void;
}

export function HolidayForm({ title, initial, saving, onSubmit, onCancel }: Props) {
  const id = useId();
  const [values, setValues] = useState<HolidayFormValues>(initial);
  const [errors, setErrors] = useState<HolidayFormErrors>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({ ...values, name: values.name.trim() });
  }

  return (
    <form className="holidays-form" onSubmit={submit} noValidate aria-label={title}>
      <h2>{title}</h2>
      <label>
        Data
        <input
          type="date"
          value={values.date}
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={errors.date ? `${id}-date` : undefined}
          onChange={(e) => setValues({ ...values, date: e.target.value })}
        />
        {errors.date && (
          <span id={`${id}-date`} className="holidays-field-error">
            {errors.date}
          </span>
        )}
      </label>
      <label>
        Nome
        <input
          type="text"
          value={values.name}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${id}-name` : undefined}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
        {errors.name && (
          <span id={`${id}-name`} className="holidays-field-error">
            {errors.name}
          </span>
        )}
      </label>
      <label>
        Abrangência
        <select
          value={values.scope}
          onChange={(e) => setValues({ ...values, scope: e.target.value as HolidayScope })}
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="holidays-form-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
