import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DEFAULT_SHIFT_TIMES, shiftDuration } from '@plantao365/shared';
import type { ShiftTimes, WeekdayShiftTime } from '@plantao365/shared';
import { api } from '../api/client';
import { formatHours } from '../schedule/format';
import { ConfirmDialog, FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { SCHEDULE_ADMIN_PATH, tabPath } from './paths';
import { describe } from './types';
import { HOLIDAY_KEY, SHIFT_TARGETS, effectiveTime, parseTarget, targetLabel } from './weekdays';
import type { ShiftTarget } from './weekdays';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Cadastro e edição do horário do plantão; o mesmo horário pode valer para vários dias. */
export function ShiftTimeForm() {
  const { key } = useParams<{ key: string }>();
  const isNew = key === undefined;
  const target = isNew ? null : parseTarget(key);
  const navigate = useNavigate();
  const [weekdays, setWeekdays] = useState<WeekdayShiftTime[] | null>(null);
  const [selected, setSelected] = useState<ShiftTarget[]>(target === null ? [] : [target]);
  const [startHour, setStartHour] = useState<number>(DEFAULT_SHIFT_TIMES.weekday.startHour);
  const [endHour, setEndHour] = useState<number>(DEFAULT_SHIFT_TIMES.weekday.endHour);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const invalidRoute = !isNew && target === null;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<ShiftTimes>('/api/shift-settings', controller.signal),
      api.get<WeekdayShiftTime[]>('/api/shift-weekday-times', controller.signal),
    ])
      .then(([times, list]) => {
        setWeekdays(list);
        if (target !== null) {
          const { time } = effectiveTime(target, times, list);
          setStartHour(time.startHour);
          setEndHour(time.endHour);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describe(err, 'Não foi possível carregar os horários.'));
        }
      });
    return () => controller.abort();
  }, [target]);

  const back = () => void navigate(tabPath('times'));
  const crumbs = [
    { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
    { label: 'Horários dos plantões', to: tabPath('times') },
    { label: target === null ? 'Novo horário' : `Editar ${targetLabel(target).toLowerCase()}` },
  ];

  const toggle = (t: ShiftTarget) => {
    setProblem(null);
    setSelected((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));
  };

  const save = async () => {
    if (selected.length === 0) {
      setProblem('Selecione ao menos um dia da semana ou feriado.');
      return;
    }
    setBusy(true);
    try {
      await api.put(
        '/api/shift-weekday-times',
        {
          weekdays: selected.filter((t): t is number => t !== HOLIDAY_KEY),
          holiday: selected.includes(HOLIDAY_KEY),
          startHour,
          endHour,
        },
        {
          successMessage: isNew
            ? 'Horário criado. Vale para os próximos rascunhos gerados.'
            : 'Horário atualizado. Vale para os próximos rascunhos gerados.',
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
    if (typeof target !== 'number') return;
    setBusy(true);
    try {
      await api.delete(`/api/shift-weekday-times?weekdays=${target}`, {
        successMessage: 'Horário excluído. O dia volta ao padrão.',
      });
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const error = invalidRoute ? 'Dia inválido.' : loadError;
  if (error) {
    return (
      <FormPage crumbs={crumbs} title="Horário do plantão" onSubmit={back}>
        <p className="alert" role="alert">
          {error}
        </p>
      </FormPage>
    );
  }
  if (!weekdays) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  // Só dá para excluir um horário cadastrado por dia da semana; feriado sempre tem horário.
  const canDelete = typeof target === 'number' && weekdays.some((w) => w.weekday === target);

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={isNew ? 'Novo horário' : `Editar horário: ${targetLabel(target!).toLowerCase()}`}
        description="O mesmo horário pode valer para vários dias. Vale para os próximos rascunhos gerados."
        onSubmit={() => void save()}
      >
        <FormSection
          title="Dias"
          description="Selecione os dias da semana e, se quiser, feriados em que este horário se aplica."
        >
          <div className="sad-row" role="group" aria-label="Dias">
            {SHIFT_TARGETS.map((t) => (
              <label key={t}>
                <input type="checkbox" checked={selected.includes(t)} onChange={() => toggle(t)} />{' '}
                {targetLabel(t)}
              </label>
            ))}
          </div>
        </FormSection>
        <FormSection
          title="Plantão"
          description="Fim menor ou igual ao início termina no dia seguinte."
        >
          <div className="ui-fields">
            <label className="ui-field">
              Início
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              Fim
              <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
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
                {formatHours(shiftDuration({ startHour, endHour }))}
                {endHour <= startHour ? ' (termina no dia seguinte)' : ''}
              </output>
            </div>
          </div>
        </FormSection>
        {problem && (
          <p className="alert" role="alert">
            {problem}
          </p>
        )}
        <FormActions
          busy={busy}
          onCancel={back}
          onDelete={canDelete ? () => setConfirming(true) : undefined}
        />
      </FormPage>
      {confirming && target !== null && (
        <ConfirmDialog
          title={`Excluir horário de ${targetLabel(target).toLowerCase()}?`}
          message="O dia volta a usar o horário padrão nas próximas escalas geradas. Escalas já geradas não mudam."
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
