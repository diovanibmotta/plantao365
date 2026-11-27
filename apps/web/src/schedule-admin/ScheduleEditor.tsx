import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { dayOfWeek } from '@diovanibmotta/plantao365-shared';
import type { DayType } from '@diovanibmotta/plantao365-shared';
import { api, describeApiError } from '../api/client';
import type { ApiError } from '../api/client';
import { toast } from '../toast/toast-store';
import { DAY_TYPE_LABEL, formatHours, formatPeriod } from '../schedule/format';
import type { ShiftDto } from '../schedule/types';
import {
  Breadcrumb,
  ConfirmDialog,
  FilterBar,
  InfoDialog,
  normalizeSearch,
  Pagination,
  usePagination,
} from '@diovanibmotta/plantao365-web-sdk';
import { SCHEDULE_ADMIN_PATH, scheduleExportPath, shiftEditPath, tabPath } from './paths';
import { downloadSchedulePdf } from './schedule-pdf';
import { WEEKDAYS } from './schedule-report';
import type { ReportContext } from './schedule-report';
import { StatusPill } from './StatusPill';
import { errorCode, errorDates, formatDate } from './types';
import type { MemberOption, ScheduleDetail } from './types';

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
  const navigate = useNavigate();
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
  const [search, setSearch] = useState('');
  const [responsible, setResponsible] = useState('');
  const [dayType, setDayType] = useState<DayType | ''>('');
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [conflictShift, setConflictShift] = useState<ShiftDto | null>(null);

  const conflictCount = useMemo(
    () => schedule.shifts.filter((s) => (s.conflicts?.length ?? 0) > 0).length,
    [schedule.shifts],
  );

  const filtered = useMemo(() => {
    const term = normalizeSearch(search);
    return schedule.shifts.filter((s) => {
      if (responsible === '__none') {
        if (s.userId) return false;
      } else if (responsible && s.userId !== responsible) {
        return false;
      }
      if (dayType && s.dayType !== dayType) return false;
      if (onlyConflicts && !(s.conflicts?.length ?? 0)) return false;
      if (!term) return true;
      return normalizeSearch(
        `${formatDate(s.date)} ${WEEKDAYS[dayOfWeek(s.date)]} ${DAY_TYPE_LABEL[s.dayType]} ${s.userName ?? ''}`,
      ).includes(term);
    });
  }, [schedule.shifts, search, responsible, dayType, onlyConflicts]);

  const filterKey = `${search}|${responsible}|${dayType}|${onlyConflicts}`;
  const pager = usePagination(filtered, filterKey);
  const clearFilters = () => {
    setSearch('');
    setResponsible('');
    setDayType('');
    setOnlyConflicts(false);
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

      {conflictCount > 0 && (
        <p className="sad-note sad-note--warn" role="status">
          ⚠ {conflictCount} {conflictCount === 1 ? 'plantão em conflito' : 'plantões em conflito'}.
          Use o filtro "Somente com conflito" e clique em "Ver motivo".
        </p>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Buscar por data, dia ou responsável"
        onClear={clearFilters}
        clearable={Boolean(search || responsible || dayType || onlyConflicts)}
      >
        <select
          aria-label="Responsável"
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
        >
          <option value="">Todos os responsáveis</option>
          <option value="__none">Sem responsável</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Tipo de dia"
          value={dayType}
          onChange={(e) => setDayType(e.target.value as DayType | '')}
        >
          <option value="">Todos os tipos de dia</option>
          {(Object.keys(DAY_TYPE_LABEL) as DayType[]).map((t) => (
            <option key={t} value={t}>
              {DAY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Conflitos"
          value={onlyConflicts ? 'only' : ''}
          onChange={(e) => setOnlyConflicts(e.target.value === 'only')}
        >
          <option value="">Com e sem conflito</option>
          <option value="only">Somente com conflito</option>
        </select>
      </FilterBar>

      <div className="sad-table-wrap">
        <table className="sad-table sad-shifts" aria-label="Plantões da escala">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Dia</th>
              <th scope="col">Responsável</th>
              <th scope="col">Horário</th>
              <th scope="col">Horas</th>
              <th scope="col">Conflito</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nenhum plantão encontrado para os filtros aplicados.
                </td>
              </tr>
            )}
            {pager.slice.map((shift) => {
              const vacation = shift.dayType === 'collective_vacation';
              const editPath = shiftEditPath(schedule.id, shift.id);
              return (
                <tr
                  key={shift.id}
                  onClick={vacation ? undefined : () => void navigate(editPath)}
                  style={vacation ? undefined : { cursor: 'pointer' }}
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
                      (shift.userName ?? <span className="muted">Sem responsável</span>)
                    )}
                  </td>
                  <td>{vacation ? '—' : formatPeriod(shift)}</td>
                  <td className="sad-num">{vacation ? '—' : formatHours(shift.hours)}</td>
                  <td>
                    {(shift.conflicts?.length ?? 0) > 0 ? (
                      <button
                        type="button"
                        className="btn sm sad-conflict-btn"
                        aria-label={`Ver motivo do conflito em ${formatDate(shift.date)}`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setConflictShift(shift);
                        }}
                      >
                        ⚠ Ver motivo
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="ui-col-actions">
                    {!vacation && (
                      <Link
                        to={editPath}
                        className="btn sm"
                        aria-label={`Editar plantão de ${formatDate(shift.date)}`}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        Editar
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        total={schedule.shifts.length}
        filtered={filtered.length}
        page={pager.page}
        pages={pager.pages}
        pageSize={pager.pageSize}
        onPage={pager.setPage}
        onPageSize={pager.setPageSize}
        noun={['plantão', 'plantões']}
      />

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

      {conflictShift && (
        <InfoDialog
          title={`Conflito em ${formatDate(conflictShift.date)}`}
          onClose={() => setConflictShift(null)}
        >
          <p>
            {WEEKDAYS[dayOfWeek(conflictShift.date)]}
            {conflictShift.userName ? ` · ${conflictShift.userName}` : ' · sem responsável'}
          </p>
          <ul className="sad-conflict-reasons">
            {(conflictShift.conflicts ?? []).map((c, i) => (
              <li key={`${c.code}-${i}`}>{c.message}</li>
            ))}
          </ul>
        </InfoDialog>
      )}
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
