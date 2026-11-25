import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  findOverlap,
  formatMinute,
  overlapMessage,
  parseMinute,
  sortWorkPeriods,
  validateWorkPeriods,
} from '@diovanibmotta/plantao365-shared';
import type { WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import { SCHEDULE_ADMIN_PATH, tabPath } from './paths';
import { describe } from './types';
import { formatDuration } from './WorkHoursList';

const NEW_PERIOD: WorkPeriod = { startMinute: 480, endMinute: 720 };
/** O campo de hora não aceita 24:00; o fim às 24:00 aparece como 23:59. */
const fieldValue = (minute: number) => formatMinute(minute === 1440 ? 1439 : minute);

/** Cadastro, edição e exclusão de um período da jornada de trabalho. Sobreposição é bloqueada. */
export function WorkHoursForm() {
  const { position } = useParams<{ position: string }>();
  const isNew = position === undefined;
  const index = isNew ? -1 : Number(position);
  const invalidRoute = !isNew && !(Number.isInteger(index) && index >= 0);
  const navigate = useNavigate();
  const [others, setOthers] = useState<WorkPeriod[] | null>(null);
  const [period, setPeriod] = useState<WorkPeriod>(NEW_PERIOD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (invalidRoute) return;
    const controller = new AbortController();
    api
      .get<{ periods: WorkPeriod[] }>('/api/work-hours', controller.signal)
      .then((r) => {
        const sorted = sortWorkPeriods(r.periods);
        if (isNew) {
          setOthers(sorted);
          // Sugere o intervalo seguinte ao último período, sem sobrepor.
          const last = sorted.at(-1);
          if (last) {
            const start = Math.min(last.endMinute + 60, 1380);
            setPeriod({ startMinute: start, endMinute: Math.min(start + 240, 1440) });
          }
          return;
        }
        const current = sorted[index];
        if (!current) {
          setLoadError('Período não encontrado.');
          return;
        }
        setPeriod(current);
        setOthers(sorted.filter((_, i) => i !== index));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describe(err, 'Não foi possível carregar a jornada.'));
        }
      });
    return () => controller.abort();
  }, [isNew, index, invalidRoute]);

  const back = () => void navigate(tabPath('work-hours'));
  const crumbs = [
    { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
    { label: 'Jornada de trabalho', to: tabPath('work-hours') },
    { label: isNew ? 'Novo período' : `Editar período ${index + 1}` },
  ];

  const update = (key: keyof WorkPeriod, text: string) => {
    const value = parseMinute(text);
    if (value !== null) setPeriod((p) => ({ ...p, [key]: value }));
  };

  // Alerta ao vivo: o período não pode sobrepor nenhum outro.
  const clash = others ? findOverlap(others, period) : null;
  const problem = clash ? overlapMessage(period, clash) : (validateWorkPeriods([period]) ?? null);

  const persist = async (next: WorkPeriod[], successMessage: string) => {
    setBusy(true);
    try {
      await api.put<{ periods: WorkPeriod[] }>(
        '/api/work-hours',
        { periods: sortWorkPeriods(next) },
        { successMessage },
      );
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!others || problem) return;
    void persist([...others, period], isNew ? 'Período criado.' : 'Período atualizado.');
  };

  const remove = () => {
    if (!others) return;
    void persist(others, 'Período excluído.');
  };

  const error = invalidRoute ? 'Período inválido.' : loadError;
  if (error) {
    return (
      <FormPage crumbs={crumbs} title="Período da jornada" onSubmit={back}>
        <p className="alert" role="alert">
          {error}
        </p>
      </FormPage>
    );
  }
  if (!others) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={isNew ? 'Novo período' : `Editar período ${index + 1}`}
        description="Os períodos não podem se sobrepor; não há limite de períodos."
        onSubmit={save}
      >
        <FormSection title="Período" description="Intervalo em que todo o time está trabalhando.">
          <div className="ui-fields">
            <label className="ui-field ui-field--wide">
              Nome
              <input
                type="text"
                maxLength={60}
                value={period.name ?? ''}
                placeholder="Manhã"
                onChange={(e) => setPeriod((p) => ({ ...p, name: e.target.value }))}
              />
            </label>
            <label className="ui-field">
              Início
              <input
                type="time"
                value={fieldValue(period.startMinute)}
                onChange={(e) => update('startMinute', e.target.value)}
              />
            </label>
            <label className="ui-field">
              Fim
              <input
                type="time"
                value={fieldValue(period.endMinute)}
                onChange={(e) => update('endMinute', e.target.value)}
              />
            </label>
            <div className="ui-field">
              Duração
              <output>
                {period.endMinute > period.startMinute
                  ? formatDuration(period.endMinute - period.startMinute)
                  : '—'}
              </output>
            </div>
          </div>
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
        </FormSection>
        <FormActions
          busy={busy}
          saveDisabled={problem !== null}
          onCancel={back}
          onDelete={isNew ? undefined : () => setConfirming(true)}
        />
      </FormPage>
      {confirming && (
        <ConfirmDialog
          title={`Excluir período ${index + 1}?`}
          message="O período deixa de ser destacado no calendário. Escalas e plantões não mudam."
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
