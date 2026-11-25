import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  DEFAULT_WORK_PERIODS,
  formatMinute,
  parseMinute,
  shiftDuration,
  validateWorkPeriods,
} from '@diovanibmotta/plantao365-shared';
import type { ShiftException, WorkPeriod } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { formatHours } from '../schedule/format';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import { EXCEPTIONS_LIST_PATH, SCHEDULE_ADMIN_PATH } from './paths';
import { describe, formatDate } from './types';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Draft {
  date: string;
  note: string;
  startHour: number;
  endHour: number;
  customWork: boolean;
  workPeriods: WorkPeriod[];
}

const clonePeriods = (periods: readonly WorkPeriod[]) => periods.map((p) => ({ ...p }));

const newDraft = (teamWork: readonly WorkPeriod[]): Draft => ({
  date: '',
  note: '',
  startHour: 15,
  endHour: 8,
  customWork: false,
  workPeriods: clonePeriods(teamWork),
});

async function findException(date: string, signal?: AbortSignal): Promise<ShiftException | null> {
  const list = await api.get<ShiftException[]>(
    `/api/shift-exceptions?from=${date}&to=${date}`,
    signal,
  );
  return list[0] ?? null;
}

/** Cadastro, edição e exclusão de uma exceção de horário (rota própria, separada da listagem). */
export function ShiftExceptionForm() {
  const { date: routeDate } = useParams<{ date: string }>();
  const isNew = routeDate === undefined;
  const navigate = useNavigate();
  const [teamWork, setTeamWork] = useState<readonly WorkPeriod[]>(DEFAULT_WORK_PERIODS);
  const [draft, setDraft] = useState<Draft | null>(isNew ? newDraft(DEFAULT_WORK_PERIODS) : null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const invalidDate = !isNew && !ISO_DATE.test(routeDate);
  const loadError = invalidDate ? 'Data inválida.' : fetchError;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const fail = (err: unknown) => {
      if (!controller.signal.aborted) {
        setFetchError(describe(err, 'Não foi possível carregar a exceção.'));
      }
    };
    api
      .get<{ periods: WorkPeriod[] }>('/api/work-hours', controller.signal)
      .then((r) => {
        setTeamWork(r.periods);
        if (isNew)
          setDraft((d) =>
            d && !d.customWork ? { ...d, workPeriods: clonePeriods(r.periods) } : d,
          );
      })
      .catch(() => undefined);
    if (!isNew) {
      if (ISO_DATE.test(routeDate)) {
        findException(routeDate, controller.signal)
          .then((e) => {
            if (!e) {
              setFetchError('Exceção não encontrada.');
              return;
            }
            setDraft({
              date: e.date,
              note: e.note ?? '',
              startHour: e.startHour,
              endHour: e.endHour,
              customWork: e.workPeriods !== null,
              workPeriods: e.workPeriods ? clonePeriods(e.workPeriods) : [],
            });
          })
          .catch(fail);
      }
    }
    return () => controller.abort();
  }, [isNew, routeDate]);

  const back = () => void navigate(EXCEPTIONS_LIST_PATH);

  const patch = (p: Partial<Draft>) => {
    setProblem(null);
    setDraft((d) => (d ? { ...d, ...p } : d));
  };

  const setCustomWork = (custom: boolean) => {
    if (!draft) return;
    const periods = draft.workPeriods.length > 0 ? draft.workPeriods : clonePeriods(teamWork);
    patch({ customWork: custom, workPeriods: periods });
  };

  const updatePeriod = (index: number, key: keyof WorkPeriod, text: string) => {
    const value = parseMinute(text);
    if (value === null || !draft) return;
    patch({
      workPeriods: draft.workPeriods.map((p, i) => (i === index ? { ...p, [key]: value } : p)),
    });
  };

  const addPeriod = () => {
    if (!draft) return;
    const start = Math.min((draft.workPeriods.at(-1)?.endMinute ?? 480) + 60, 1380);
    patch({
      workPeriods: [
        ...draft.workPeriods,
        { startMinute: start, endMinute: Math.min(start + 120, 1440) },
      ],
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!ISO_DATE.test(draft.date)) {
      setProblem('Informe a data.');
      return;
    }
    const workProblem = draft.customWork ? validateWorkPeriods(draft.workPeriods) : null;
    if (workProblem) {
      setProblem(workProblem);
      return;
    }
    setBusy(true);
    try {
      if (isNew && (await findException(draft.date))) {
        setProblem(
          `Já existe uma exceção para ${formatDate(draft.date)}. Edite o registro existente.`,
        );
        return;
      }
      await api.put<ShiftException>(
        `/api/shift-exceptions/${draft.date}`,
        {
          startHour: draft.startHour,
          endHour: draft.endHour,
          workPeriods: draft.customWork ? draft.workPeriods : null,
          note: draft.note.trim() || null,
        },
        {
          successMessage: isNew
            ? 'Exceção criada. Vale para as próximas escalas geradas.'
            : 'Exceção atualizada. Vale para as próximas escalas geradas.',
        },
      );
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.delete(`/api/shift-exceptions/${draft.date}`, {
        successMessage: 'Exceção excluída.',
      });
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const crumbs = [
    { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
    { label: 'Exceções de horário', to: EXCEPTIONS_LIST_PATH },
    { label: isNew ? 'Nova exceção' : draft ? `Editar ${formatDate(draft.date)}` : 'Editar' },
  ];

  if (loadError) {
    return (
      <FormPage crumbs={crumbs} title="Exceção de horário" onSubmit={back}>
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
  if (!draft) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  const duration = shiftDuration(draft);

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={isNew ? 'Nova exceção' : 'Editar exceção'}
        description="Vale para as próximas escalas geradas."
        onSubmit={() => void save()}
      >
        <FormSection title="Identificação" description="Qual dia foge do padrão e por quê.">
          <div className="ui-fields">
            <label className="ui-field">
              Data
              <input
                type="date"
                value={draft.date}
                readOnly={!isNew}
                onChange={(e) => patch({ date: e.target.value })}
              />
            </label>
            <label className="ui-field ui-field--wide">
              Observação
              <input
                type="text"
                maxLength={120}
                value={draft.note}
                placeholder="Véspera de Natal"
                onChange={(e) => patch({ note: e.target.value })}
              />
            </label>
          </div>
        </FormSection>

        <FormSection
          title="Plantão"
          description="Horário do plantão nesta data, no lugar do padrão por tipo de dia."
        >
          <div className="ui-fields">
            <label className="ui-field">
              Início
              <select
                value={draft.startHour}
                onChange={(e) => patch({ startHour: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              Fim
              <select
                value={draft.endHour}
                onChange={(e) => patch({ endHour: Number(e.target.value) })}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </label>
            <div className="ui-field">
              Duração
              <output>
                {formatHours(duration)}
                {draft.endHour <= draft.startHour ? ' (termina no dia seguinte)' : ''}
              </output>
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Jornada de trabalho"
          description="Aparece destacada no calendário nesta data."
        >
          <div className="sad-row">
            <label>
              <input
                type="radio"
                name="work"
                checked={!draft.customWork}
                onChange={() => setCustomWork(false)}
              />{' '}
              Usar a jornada padrão da equipe
            </label>
            <label>
              <input
                type="radio"
                name="work"
                checked={draft.customWork}
                onChange={() => setCustomWork(true)}
              />{' '}
              Definir jornada para este dia
            </label>
          </div>
          {draft.customWork && (
            <ul className="sad-periods">
              {draft.workPeriods.map((p, i) => (
                <li key={i} className="sad-row">
                  <label className="ui-field">
                    Início do período {i + 1}
                    <input
                      type="time"
                      value={formatMinute(p.startMinute)}
                      onChange={(e) => updatePeriod(i, 'startMinute', e.target.value)}
                    />
                  </label>
                  <label className="ui-field">
                    Fim do período {i + 1}
                    <input
                      type="time"
                      value={formatMinute(p.endMinute === 1440 ? 1439 : p.endMinute)}
                      onChange={(e) => updatePeriod(i, 'endMinute', e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      patch({ workPeriods: draft.workPeriods.filter((_, idx) => idx !== i) })
                    }
                  >
                    Remover período {i + 1}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="btn" onClick={addPeriod}>
                  Adicionar período
                </button>
              </li>
            </ul>
          )}
        </FormSection>

        {problem && (
          <p className="alert" role="alert">
            {problem}
          </p>
        )}
        <FormActions
          busy={busy}
          onCancel={back}
          onDelete={isNew ? undefined : () => setConfirming(true)}
        />
      </FormPage>
      {confirming && (
        <ConfirmDialog
          title={`Excluir exceção de ${formatDate(draft.date)}?`}
          message="A geração das próximas escalas volta a usar o horário padrão nesta data. Escalas já geradas não mudam."
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
