import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { ApiError } from '../api/client';
import { toast } from '../toast/toast-store';
import {
  ConfirmDialog,
  FormActions,
  FormPage,
  FormSection,
} from '@diovanibmotta/plantao365-web-sdk';
import { HolidayWarnings } from './HolidayWarnings';
import { HOLIDAYS_PATH } from './paths';
import {
  EMPTY_FORM,
  errorMessage,
  formatHolidayDate,
  recalcSummary,
  SCOPES,
  validateForm,
} from './types';
import type {
  Holiday,
  HolidayFormErrors,
  HolidayFormValues,
  HolidayMutation,
  HolidayScope,
  HolidayWarning,
  RecalculateResult,
} from './types';

const saveError = (err: ApiError) => errorMessage(err, 'Não foi possível concluir a operação.');

/** Cadastro, edição e exclusão de um feriado (rota própria, separada da listagem). */
export function HolidayForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const [values, setValues] = useState<HolidayFormValues | null>(isNew ? EMPTY_FORM : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<HolidayFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [warnings, setWarnings] = useState<HolidayWarning[]>([]);
  const [confirmingRecalc, setConfirmingRecalc] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    const controller = new AbortController();
    api
      .get<Holiday>(`/api/holidays/${id}`, controller.signal)
      .then((h) => setValues({ date: h.date, name: h.name, scope: h.scope }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(err, 'Não foi possível carregar o feriado.'));
      });
    return () => controller.abort();
  }, [id]);

  const back = () => void navigate(HOLIDAYS_PATH);

  const patch = (p: Partial<HolidayFormValues>) => {
    setErrors({});
    setValues((v) => (v ? { ...v, ...p } : v));
  };

  /** Sem avisos volta à listagem; com avisos fica na tela para oferecer o recálculo. */
  const finish = (result: HolidayMutation) => {
    if (result.warnings.length === 0) {
      back();
      return;
    }
    setWarnings(result.warnings);
  };

  const save = async () => {
    if (!values) return;
    const found = validateForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = { ...values, name: values.name.trim() };
    setBusy(true);
    try {
      const result = isNew
        ? await api.post<HolidayMutation>('/api/holidays', body, {
            successMessage: 'Feriado criado.',
            errorMessage: saveError,
          })
        : await api.patch<HolidayMutation>(`/api/holidays/${id}`, body, {
            successMessage: 'Feriado salvo.',
            errorMessage: saveError,
          });
      finish(result);
    } catch {
      // erro exibido pelo toast
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const result = await api.delete<HolidayMutation>(`/api/holidays/${id}`, {
        successMessage: 'Feriado removido.',
        errorMessage: saveError,
      });
      setConfirmingDelete(false);
      finish(result);
    } catch {
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const recalculate = async () => {
    setRecalculating(true);
    try {
      const result = await api.post<RecalculateResult>(
        '/api/holidays/recalculate',
        { dates: [...new Set(warnings.map((w) => w.date))] },
        { silentSuccess: true },
      );
      toast.success(recalcSummary(result.updated));
      back();
    } catch {
      // erro exibido pelo toast
    } finally {
      setRecalculating(false);
      setConfirmingRecalc(false);
    }
  };

  const crumbs = [
    { label: 'Feriados', to: HOLIDAYS_PATH },
    {
      label: isNew
        ? 'Novo feriado'
        : values
          ? `Editar ${formatHolidayDate(values.date)}`
          : 'Editar',
    },
  ];

  if (loadError) {
    return (
      <FormPage crumbs={crumbs} title="Feriado" onSubmit={back}>
        <p className="alert" role="alert">
          {loadError}
        </p>
        <div className="ui-actions">
          <button type="button" className="btn" onClick={back}>
            Voltar para a listagem
          </button>
        </div>
      </FormPage>
    );
  }
  if (!values) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  if (warnings.length > 0) {
    return (
      <FormPage crumbs={crumbs} title="Feriado salvo" onSubmit={back}>
        <HolidayWarnings
          warnings={warnings}
          onDismiss={back}
          action={
            <button type="button" className="btn primary" onClick={() => setConfirmingRecalc(true)}>
              Recalcular horas
            </button>
          }
        />
        <div className="ui-actions">
          <button type="button" className="btn" onClick={back}>
            Voltar para a listagem
          </button>
        </div>
        {confirmingRecalc && (
          <ConfirmDialog
            title="Recalcular horas?"
            message="Recalcular as horas dos plantões publicados nessas datas?"
            confirmLabel="Confirmar recálculo"
            tone="primary"
            busy={recalculating}
            onConfirm={() => void recalculate()}
            onCancel={() => setConfirmingRecalc(false)}
          />
        )}
      </FormPage>
    );
  }

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={isNew ? 'Novo feriado' : 'Editar feriado'}
        description="Feriado conta como plantão de 24h (08:00 às 08:00)."
        onSubmit={() => void save()}
      >
        <FormSection title="Identificação" description="Quando é o feriado e a quem se aplica.">
          <div className="ui-fields">
            <label className="ui-field">
              Data
              <input
                type="date"
                value={values.date}
                aria-invalid={errors.date ? true : undefined}
                onChange={(e) => patch({ date: e.target.value })}
              />
              {errors.date && (
                <span className="ui-field-error" role="alert">
                  {errors.date}
                </span>
              )}
            </label>
            <label className="ui-field ui-field--wide">
              Nome
              <input
                type="text"
                value={values.name}
                aria-invalid={errors.name ? true : undefined}
                onChange={(e) => patch({ name: e.target.value })}
              />
              {errors.name && (
                <span className="ui-field-error" role="alert">
                  {errors.name}
                </span>
              )}
            </label>
            <label className="ui-field">
              Abrangência
              <select
                value={values.scope}
                onChange={(e) => patch({ scope: e.target.value as HolidayScope })}
              >
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </FormSection>
        <FormActions
          busy={busy}
          onCancel={back}
          onDelete={isNew ? undefined : () => setConfirmingDelete(true)}
        />
      </FormPage>
      {confirmingDelete && (
        <ConfirmDialog
          title={`Excluir “${values.name}”?`}
          message="O dia deixa de ser feriado nas próximas escalas geradas. Se houver plantões publicados nessa data, as horas só mudam ao recalcular, o que será oferecido em seguida."
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
