import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { dayOfWeek, shiftDuration } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import { toast } from '../toast/toast-store';
import { DAY_TYPE_LABEL, formatHours, localDateMinute } from '../schedule/format';
import type { ShiftDto } from '../schedule/types';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import { SCHEDULE_ADMIN_PATH, schedulePath, tabPath } from './paths';
import { describe, formatDate } from './types';
import type { EditResult, MemberOption, ScheduleDetail } from './types';
import { WEEKDAY_NAME } from './weekdays';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Horas cheias do plantão: do instante gravado ou, sem ele, do padrão do tipo de dia. */
function currentHours(shift: ShiftDto): { startHour: number; endHour: number } {
  if (shift.startsAt && shift.endsAt) {
    return {
      startHour: Math.floor(localDateMinute(shift.startsAt).minute / 60),
      endHour: Math.floor(localDateMinute(shift.endsAt).minute / 60),
    };
  }
  return shift.dayType === 'weekday' ? { startHour: 18, endHour: 8 } : { startHour: 8, endHour: 8 };
}

/** Edição de um plantão: responsável e horário de início e fim, em rota própria. */
export function ShiftEditForm() {
  const { id = '', shiftId = '' } = useParams<{ id: string; shiftId: string }>();
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState<ScheduleDetail | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [userId, setUserId] = useState('');
  const [startHour, setStartHour] = useState(18);
  const [endHour, setEndHour] = useState(8);
  const [reason, setReason] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shift = schedule?.shifts.find((s) => s.id === shiftId) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<ScheduleDetail>(`/api/schedules/${id}`, controller.signal),
      api.get<MemberOption[]>('/api/users', controller.signal),
    ])
      .then(([detail, list]) => {
        setSchedule(detail);
        setMembers(list);
        const found = detail.shifts.find((s) => s.id === shiftId);
        if (found) {
          setUserId(found.userId ?? '');
          const hours = currentHours(found);
          setStartHour(hours.startHour);
          setEndHour(hours.endHour);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describe(err, 'Não foi possível carregar o plantão.'));
        }
      });
    return () => controller.abort();
  }, [id, shiftId]);

  const back = () => void navigate(schedulePath(id));
  const crumbs = [
    { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
    { label: 'Escalas', to: tabPath('schedules') },
    schedule
      ? {
          label: `${formatDate(schedule.startDate)} a ${formatDate(schedule.endDate)}`,
          to: schedulePath(id),
        }
      : { label: 'Escala', to: schedulePath(id) },
    { label: shift ? `Editar plantão de ${formatDate(shift.date)}` : 'Editar plantão' },
  ];

  const error =
    loadError ??
    (schedule && !shift ? 'Plantão não encontrado.' : null) ??
    (shift?.dayType === 'collective_vacation'
      ? 'Dia de férias coletivas não tem plantão para editar.'
      : null);
  if (error) {
    return (
      <FormPage crumbs={crumbs} title="Editar plantão" onSubmit={back}>
        <p className="alert" role="alert">
          {error}
        </p>
        <div className="ui-actions">
          <span className="ui-actions-spacer" />
          <button type="button" className="btn" onClick={back}>
            Voltar para a listagem
          </button>
        </div>
      </FormPage>
    );
  }
  if (!schedule || !shift) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  const published = schedule.status === 'published';
  const initial = currentHours(shift);
  const userChanged = userId !== (shift.userId ?? '');
  const timeChanged = startHour !== initial.startHour || endHour !== initial.endHour;
  const changed = userChanged || timeChanged;
  const needsReason = published && changed && !reason.trim();
  const problem = !changed
    ? null
    : needsReason
      ? 'Informe o motivo: alterações em escala publicada exigem justificativa.'
      : null;

  const save = async () => {
    if (!changed) {
      back();
      return;
    }
    if (needsReason) {
      toast.warning('Informe o motivo da alteração.');
      return;
    }
    const body: {
      userId?: string | null;
      startHour?: number;
      endHour?: number;
      reason?: string;
    } = {};
    if (userChanged) body.userId = userId || null;
    if (timeChanged) {
      body.startHour = startHour;
      body.endHour = endHour;
    }
    if (published) body.reason = reason.trim();
    setBusy(true);
    try {
      const res = await api.patch<EditResult>(`/api/schedules/${id}/shifts/${shiftId}`, body, {
        successMessage: 'Plantão atualizado.',
      });
      if (res.notice) toast.success(res.notice);
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormPage
      crumbs={crumbs}
      title={`Editar plantão de ${formatDate(shift.date)}`}
      description={`${WEEKDAY_NAME[dayOfWeek(shift.date)]} · ${DAY_TYPE_LABEL[shift.dayType]}${
        published
          ? '. Escala publicada: o motivo é obrigatório e os membros serão notificados.'
          : ''
      }`}
      onSubmit={() => void save()}
    >
      <FormSection title="Responsável" description="Quem cumpre o plantão neste dia.">
        <div className="ui-fields">
          <label className="ui-field">
            Responsável
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Sem responsável</option>
              {members
                .filter((m) => m.active || m.id === shift.userId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.active ? '' : ' (inativo)'}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </FormSection>
      <FormSection
        title="Horário"
        description="Fim menor ou igual ao início termina no dia seguinte. Vale só para este plantão."
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
      {published && (
        <FormSection title="Motivo" description="Registrado na auditoria e enviado aos membros.">
          <div className="ui-fields">
            <label className="ui-field">
              Motivo (obrigatório)
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
        </FormSection>
      )}
      {problem && (
        <p className="alert" role="alert">
          {problem}
        </p>
      )}
      <FormActions busy={busy} onCancel={back} saveDisabled={!changed || needsReason} />
    </FormPage>
  );
}
