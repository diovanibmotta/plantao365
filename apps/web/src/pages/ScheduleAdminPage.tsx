import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { GenerateForm, GenerateReport } from '../schedule-admin/GenerateForm';
import { StatusPill } from '../schedule-admin/StatusPill';
import { ScheduleEditor } from '../schedule-admin/ScheduleEditor';
import { ShiftSettingsForm } from '../schedule-admin/ShiftSettingsForm';
import { WorkHoursForm } from '../schedule-admin/WorkHoursForm';
import { describe, formatDate } from '../schedule-admin/types';
import type {
  GenerateResult,
  MemberOption,
  ScheduleDetail,
  ScheduleDto,
} from '../schedule-admin/types';
import '../schedule-admin/schedule-admin.css';
import { PageTitle } from '../team/PageTitle';

type StatusFilter = '' | ScheduleDto['status'];
type Tab = 'schedules' | 'times' | 'work-hours';

const TABS: { id: Tab; label: string }[] = [
  { id: 'schedules', label: 'Escalas' },
  { id: 'times', label: 'Horários dos plantões' },
  { id: 'work-hours', label: 'Jornada de trabalho' },
];

export function ScheduleAdminPage() {
  const [schedules, setSchedules] = useState<ScheduleDto[] | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [onDate, setOnDate] = useState('');
  const [tab, setTab] = useState<Tab>('schedules');
  const [generating, setGenerating] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setSchedules(await api.get<ScheduleDto[]>('/api/schedules'));
    } catch (err) {
      setError(describe(err, 'Não foi possível carregar as escalas.'));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const fail = (err: unknown, fallback: string) => {
      if (!controller.signal.aborted) setError(describe(err, fallback));
    };
    api
      .get<ScheduleDto[]>('/api/schedules', controller.signal)
      .then(setSchedules)
      .catch((err: unknown) => fail(err, 'Não foi possível carregar as escalas.'));
    api
      .get<MemberOption[]>('/api/users', controller.signal)
      .then(setMembers)
      .catch((err: unknown) => fail(err, 'Não foi possível carregar a equipe.'));
    return () => controller.abort();
  }, []);

  const open = useCallback(async (id: string): Promise<void> => {
    try {
      setDetail(await api.get<ScheduleDetail>(`/api/schedules/${id}`));
    } catch (err) {
      setError(describe(err, 'Não foi possível abrir a escala.'));
    }
  }, []);

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  // Datas ISO (AAAA-MM-DD) comparam corretamente como string.
  const filtered = (schedules ?? []).filter(
    (s) =>
      (!status || s.status === status) &&
      (!onDate || (s.startDate <= onDate && onDate <= s.endDate)),
  );

  return (
    <section>
      <div className="sad-head">
        <PageTitle>Escala</PageTitle>
        <button type="button" className="btn primary" onClick={() => setGenerating(true)}>
          Gerar escala
        </button>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="sad-tabs" role="tablist" aria-label="Seções da escala">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`sad-tab-${t.id}`}
            className="sad-tab"
            aria-selected={tab === t.id}
            aria-controls="sad-panel"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="sad-panel" role="tabpanel" aria-labelledby={`sad-tab-${tab}`}>
        {tab === 'times' && <ShiftSettingsForm />}
        {tab === 'work-hours' && <WorkHoursForm />}
        {tab === 'schedules' && (
          <>
            <section aria-label="Escalas" className="sad-block">
              <div className="sad-row" role="search">
                <label>
                  Situação
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  >
                    <option value="">Todas</option>
                    <option value="draft">Rascunho</option>
                    <option value="published">Publicada</option>
                  </select>
                </label>
                <label>
                  Contém a data
                  <input type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
                </label>
              </div>
              {schedules === null && (
                <p className="status" role="status">
                  Carregando…
                </p>
              )}
              {schedules?.length === 0 && <p className="muted">Nenhuma escala criada.</p>}
              {schedules && schedules.length > 0 && filtered.length === 0 && (
                <p className="muted">Nenhuma escala encontrada.</p>
              )}
              {filtered.length > 0 && (
                <table className="sad-table" aria-label="Escalas">
                  <thead>
                    <tr>
                      <th scope="col">Período</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => {
                      const period = `${formatDate(s.startDate)} a ${formatDate(s.endDate)}`;
                      return (
                        <tr key={s.id}>
                          <td>{period}</td>
                          <td>
                            <StatusPill status={s.status} />
                          </td>
                          <td className="sad-actions">
                            <button
                              type="button"
                              className="btn"
                              aria-pressed={detail?.id === s.id}
                              aria-label={`Abrir escala de ${period}`}
                              onClick={() => {
                                setError(null);
                                void open(s.id);
                              }}
                            >
                              Abrir
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            {result && <GenerateReport names={names} result={result} />}

            {detail && (
              <ScheduleEditor
                key={detail.id}
                schedule={detail}
                members={members}
                onChanged={() => {
                  void open(detail.id);
                  void reload();
                }}
                onDiscarded={() => {
                  setDetail(null);
                  setResult(null);
                  void reload();
                }}
              />
            )}
          </>
        )}
      </div>

      {generating && (
        <div
          className="sad-overlay"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setGenerating(false);
          }}
        >
          <div
            className="sad-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sad-gen-title"
          >
            <h2 id="sad-gen-title">Gerar escala</h2>
            <GenerateForm
              onCancel={() => setGenerating(false)}
              onGenerated={(r) => {
                setGenerating(false);
                setTab('schedules');
                setResult(r);
                setError(null);
                void reload();
                void open(r.schedule.id);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
