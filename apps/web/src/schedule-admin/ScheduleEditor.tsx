import { useState } from 'react';
import { isWeekend } from '@diovanibmotta/plantao365-shared';
import { api } from '../api/client';
import {
  WEEK_HEADERS,
  addMonths,
  buildMonthGrid,
  monthKeyOf,
  monthLabel,
} from '../schedule/calendar';
import type { MonthKey } from '../schedule/calendar';
import { formatDayShort, formatHours } from '../schedule/format';
import type { ShiftDto } from '../schedule/types';
import { describe, errorCode, errorDates, formatDate } from './types';
import type { EditResult, MemberOption, ScheduleDetail } from './types';

interface ScheduleEditorProps {
  schedule: ScheduleDetail;
  members: MemberOption[];
  onChanged: () => void;
  onDiscarded: () => void;
}

type Notice = { kind: 'ok' | 'error'; text: string };

export function ScheduleEditor({ schedule, members, onChanged, onDiscarded }: ScheduleEditorProps) {
  const published = schedule.status === 'published';
  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(schedule.startDate));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmDates, setConfirmDates] = useState<string[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const shifts = new Map<string, ShiftDto>(schedule.shifts.map((s) => [s.date, s]));
  const selected = schedule.shifts.find((s) => s.id === selectedId) ?? null;

  const select = (s: ShiftDto) => {
    setSelectedId(s.id);
    setUserId(s.userId ?? '');
    setReason('');
    setWarnings([]);
    setNotice(null);
  };

  const save = async () => {
    if (!selected) return;
    if (published && !reason.trim()) {
      setNotice({ kind: 'error', text: 'Informe o motivo da alteração.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const body: { userId: string | null; reason?: string } = { userId: userId || null };
      if (reason.trim()) body.reason = reason.trim();
      const res = await api.patch<EditResult>(
        `/api/schedules/${schedule.id}/shifts/${selected.id}`,
        body,
      );
      setWarnings(res.warnings.map((w) => w.message));
      setNotice({ kind: 'ok', text: res.notice ?? 'Plantão atualizado.' });
      setReason('');
      onChanged();
    } catch (err) {
      setNotice({ kind: 'error', text: describe(err, 'Não foi possível alterar o plantão.') });
    } finally {
      setBusy(false);
    }
  };

  const publish = async (confirmUnassigned: boolean) => {
    setBusy(true);
    setNotice(null);
    try {
      await api.post(
        `/api/schedules/${schedule.id}/publish`,
        confirmUnassigned ? { confirmUnassigned: true } : {},
      );
      setConfirmDates(null);
      setNotice({ kind: 'ok', text: 'Escala publicada.' });
      onChanged();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'confirmation_required') {
        setConfirmDates(errorDates(err));
      } else {
        setConfirmDates(null);
        setNotice({
          kind: 'error',
          text:
            code === 'schedule_overlap_published'
              ? 'O período se sobrepõe a uma escala já publicada.'
              : describe(err, 'Não foi possível publicar a escala.'),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api.delete(`/api/schedules/${schedule.id}`);
      onDiscarded();
    } catch (err) {
      setConfirmDiscard(false);
      setNotice({ kind: 'error', text: describe(err, 'Não foi possível descartar o rascunho.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="sad-editor-title" className="sad-block">
      <h2 id="sad-editor-title">
        {published ? 'Escala publicada' : 'Rascunho'}: {formatDate(schedule.startDate)} a{' '}
        {formatDate(schedule.endDate)}
      </h2>
      {published && (
        <p className="sad-note">
          Alterações em escala publicada exigem motivo e o membro será notificado.
        </p>
      )}

      <div className="sad-row">
        <button
          type="button"
          className="btn"
          aria-label="Mês anterior"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </button>
        <strong className="sad-month" aria-live="polite">
          {monthLabel(month)}
        </strong>
        <button
          type="button"
          className="btn"
          aria-label="Próximo mês"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </button>
      </div>

      <ul className="sad-weekdays" aria-hidden="true">
        {WEEK_HEADERS.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <ol className="sad-grid" aria-label={`Escala de ${monthLabel(month)}`}>
        {buildMonthGrid(month).map((date, i) => {
          if (!date) return <li key={`pad-${i}`} className="sad-day sad-day--outside" />;
          const shift = shifts.get(date);
          const vacation = shift?.dayType === 'collective_vacation';
          return (
            <li
              key={date}
              className={`sad-day${
                shift?.dayType === 'holiday'
                  ? ' sad-day--holiday'
                  : isWeekend(date)
                    ? ' sad-day--weekend'
                    : ''
              }`}
              data-testid={`sad-day-${date}`}
            >
              <span className="sad-day-number">{Number(date.slice(8, 10))}</span>
              {vacation && <span className="muted">Férias coletivas</span>}
              {shift && !vacation && (
                <button
                  type="button"
                  className={`sad-shift${shift.userId ? '' : ' sad-shift--empty'}${
                    shift.id === selectedId ? ' sad-shift--selected' : ''
                  }`}
                  aria-pressed={shift.id === selectedId}
                  aria-label={`${formatDayShort(date)}: ${shift.userName ?? 'sem responsável'}`}
                  onClick={() => select(shift)}
                >
                  {shift.userName ?? 'Sem responsável'}
                  <span className="muted"> {formatHours(shift.hours)}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {selected && (
        <form
          className="sad-edit"
          aria-label={`Editar plantão de ${formatDate(selected.date)}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>Plantão de {formatDate(selected.date)}</h3>
          <label>
            Responsável
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Sem responsável</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.active ? '' : ' (inativo)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            {published ? 'Motivo (obrigatório)' : 'Motivo (opcional)'}
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" className="btn primary" disabled={busy}>
            Salvar plantão
          </button>
        </form>
      )}

      {warnings.length > 0 && (
        <ul className="sad-warnings" aria-label="Avisos de conflito">
          {warnings.map((w) => (
            <li key={w}>Aviso: {w}</li>
          ))}
        </ul>
      )}
      {notice?.kind === 'ok' && <p role="status">{notice.text}</p>}
      {notice?.kind === 'error' && (
        <p className="alert" role="alert">
          {notice.text}
        </p>
      )}

      {!published && (
        <div className="sad-row">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void publish(false)}
          >
            Publicar escala
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setConfirmDiscard(true)}
          >
            Descartar rascunho
          </button>
        </div>
      )}

      {confirmDates && (
        <div className="sad-confirm" role="alertdialog" aria-label="Confirmar publicação">
          <p>
            Há dias sem responsável
            {confirmDates.length > 0 ? `: ${confirmDates.map(formatDate).join(', ')}` : ''}.
            Publicar mesmo assim?
          </p>
          <div className="sad-row">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void publish(true)}
            >
              Publicar mesmo assim
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDates(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {confirmDiscard && (
        <div className="sad-confirm" role="alertdialog" aria-label="Confirmar descarte">
          <p>Descartar este rascunho? Esta ação não pode ser desfeita.</p>
          <div className="sad-row">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void discard()}
            >
              Confirmar descarte
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
