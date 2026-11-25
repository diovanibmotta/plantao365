import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { dayOfWeek } from '@diovanibmotta/plantao365-shared';
import { api, describeApiError } from '../api/client';
import type { ApiError } from '../api/client';
import { toast } from '../toast/toast-store';
import { DAY_TYPE_LABEL, formatHours, formatPeriod } from '../schedule/format';
import type { ShiftDto } from '../schedule/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Breadcrumb } from '../ui/FormPage';
import { SCHEDULE_ADMIN_PATH, scheduleExportPath, tabPath } from './paths';
import { downloadSchedulePdf } from './schedule-pdf';
import { WEEKDAYS } from './schedule-report';
import type { ReportContext } from './schedule-report';
import { StatusPill } from './StatusPill';
import { errorCode, errorDates, formatDate } from './types';
import type { EditResult, MemberOption, ScheduleDetail } from './types';

interface ScheduleEditorProps {
  schedule: ScheduleDetail;
  members: MemberOption[];
  report: ReportContext;
  onChanged: () => void;
  onDiscarded: () => void;
  onBack: () => void;
}

const publishError = (err: ApiError): string =>
  errorCode(err) === 'schedule_overlap_published'
    ? 'O período se sobrepõe a uma escala já publicada.'
    : describeApiError(err);

export function ScheduleEditor({
  schedule,
  members,
  report,
  onChanged,
  onDiscarded,
  onBack,
}: ScheduleEditorProps) {
  const published = schedule.status === 'published';
  const [pending, setPending] = useState<{ shiftId: string; userId: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDates, setConfirmDates] = useState<string[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadSchedulePdf(schedule, report);
    } catch {
      toast.error('Não foi possível gerar o PDF da escala.');
    } finally {
      setPdfBusy(false);
    }
  };

  const persist = async (shift: ShiftDto, userId: string, why?: string) => {
    setBusy(true);
    try {
      const body: { userId: string | null; reason?: string } = { userId: userId || null };
      if (why) body.reason = why;
      const res = await api.patch<EditResult>(
        `/api/schedules/${schedule.id}/shifts/${shift.id}`,
        body,
        { successMessage: 'Plantão atualizado.' },
      );
      if (res.notice) toast.success(res.notice);
      setPending(null);
      setReason('');
      onChanged();
    } catch {
      // erro exibido pelo toast
    } finally {
      setBusy(false);
    }
  };

  // Rascunho grava na hora; escala publicada pede motivo antes de gravar.
  const change = (shift: ShiftDto, userId: string) => {
    if (userId === (shift.userId ?? '')) {
      setPending(null);
      return;
    }
    if (published) {
      setPending({ shiftId: shift.id, userId });
      setReason('');
      return;
    }
    void persist(shift, userId);
  };

  const confirmPending = (shift: ShiftDto) => {
    if (!pending) return;
    if (!reason.trim()) {
      toast.warning('Informe o motivo da alteração.');
      return;
    }
    void persist(shift, pending.userId, reason.trim());
  };

  const publish = async (confirmUnassigned: boolean) => {
    setBusy(true);
    try {
      await api.post(
        `/api/schedules/${schedule.id}/publish`,
        confirmUnassigned ? { confirmUnassigned: true } : {},
        {
          successMessage: 'Escala publicada.',
          errorMessage: publishError,
          silentError: (err) => errorCode(err) === 'confirmation_required',
        },
      );
      setConfirmDates(null);
      onChanged();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'confirmation_required') {
        setConfirmDates(errorDates(err));
      } else {
        setConfirmDates(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api.delete(`/api/schedules/${schedule.id}`, { successMessage: 'Rascunho descartado.' });
      onDiscarded();
    } catch {
      setConfirmDiscard(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sad-block">
      <Breadcrumb
        crumbs={[
          { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
          { label: 'Escalas', to: tabPath('schedules') },
          { label: `${formatDate(schedule.startDate)} a ${formatDate(schedule.endDate)}` },
        ]}
      />
      <div className="sad-editor-title ui-form-head">
        <h2 id="sad-editor-title">
          {published ? 'Escala publicada' : 'Rascunho'}: {formatDate(schedule.startDate)} a{' '}
          {formatDate(schedule.endDate)}
        </h2>
        <StatusPill status={schedule.status} />
        <div className="sad-editor-actions sad-editor-exports">
          <button
            type="button"
            className="btn"
            disabled={pdfBusy}
            onClick={() => void downloadPdf()}
          >
            {pdfBusy ? 'Gerando PDF…' : 'Relatório PDF'}
          </button>
          <Link className="btn" to={scheduleExportPath(schedule.id)}>
            Exportar CSV
          </Link>
        </div>
      </div>
      {published && (
        <p className="sad-note">
          Alterações em escala publicada exigem motivo e o membro será notificado.
        </p>
      )}

      <div className="sad-table-wrap">
        <table className="sad-table sad-shifts" aria-label="Plantões da escala">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Dia</th>
              <th scope="col">Responsável</th>
              <th scope="col">Horário</th>
              <th scope="col">Horas</th>
            </tr>
          </thead>
          <tbody>
            {schedule.shifts.map((shift) => {
              const vacation = shift.dayType === 'collective_vacation';
              const editing = pending?.shiftId === shift.id;
              const value = editing ? pending.userId : (shift.userId ?? '');
              return (
                <Fragment key={shift.id}>
                  <tr
                    className={`sad-shift-row${
                      shift.dayType === 'holiday'
                        ? ' sad-shift-row--holiday'
                        : shift.dayType === 'weekend'
                          ? ' sad-shift-row--weekend'
                          : ''
                    }${!vacation && !shift.userId ? ' sad-shift-row--empty' : ''}`}
                  >
                    <td>{formatDate(shift.date)}</td>
                    <td>
                      {WEEKDAYS[dayOfWeek(shift.date)]}
                      {shift.dayType !== 'weekday' && (
                        <span className="muted"> · {DAY_TYPE_LABEL[shift.dayType]}</span>
                      )}
                    </td>
                    <td>
                      {vacation ? (
                        <span className="muted">Férias coletivas</span>
                      ) : (
                        <select
                          aria-label={`Responsável em ${formatDate(shift.date)}`}
                          value={value}
                          disabled={busy}
                          onChange={(e) => change(shift, e.target.value)}
                        >
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
                      )}
                    </td>
                    <td>{vacation ? '—' : formatPeriod(shift)}</td>
                    <td className="sad-num">{vacation ? '—' : formatHours(shift.hours)}</td>
                  </tr>
                  {editing && (
                    <tr className="sad-shift-reason">
                      <td colSpan={5}>
                        <div className="sad-row">
                          <label>
                            Motivo (obrigatório)
                            <input
                              type="text"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy}
                            onClick={() => confirmPending(shift)}
                          >
                            Salvar plantão
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setPending(null);
                              setReason('');
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ui-actions">
        {!published && (
          <button
            type="button"
            className="btn ui-danger"
            disabled={busy}
            onClick={() => setConfirmDiscard(true)}
          >
            Descartar rascunho
          </button>
        )}
        <span className="ui-actions-spacer" />
        <button type="button" className="btn" onClick={onBack}>
          Voltar
        </button>
        {!published && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void publish(false)}
          >
            Publicar escala
          </button>
        )}
      </div>

      {confirmDates && (
        <ConfirmDialog
          tone="primary"
          title="Confirmar publicação"
          message={`Há dias sem responsável${
            confirmDates.length > 0 ? `: ${confirmDates.map(formatDate).join(', ')}` : ''
          }. Publicar mesmo assim?`}
          confirmLabel="Publicar mesmo assim"
          busy={busy}
          onConfirm={() => void publish(true)}
          onCancel={() => setConfirmDates(null)}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Descartar este rascunho?"
          message="Esta ação não pode ser desfeita."
          confirmLabel="Descartar"
          busy={busy}
          onConfirm={() => void discard()}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </section>
  );
}
