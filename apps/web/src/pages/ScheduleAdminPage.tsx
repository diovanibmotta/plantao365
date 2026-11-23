import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { GenerateForm } from '../schedule-admin/GenerateForm';
import { ScheduleEditor } from '../schedule-admin/ScheduleEditor';
import { describe, scheduleLabel } from '../schedule-admin/types';
import type {
  GenerateResult,
  MemberOption,
  ScheduleDetail,
  ScheduleDto,
} from '../schedule-admin/types';
import '../schedule-admin/schedule-admin.css';

export function ScheduleAdminPage() {
  const [schedules, setSchedules] = useState<ScheduleDto[] | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section>
      <h1>Gerenciar escala</h1>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <GenerateForm
        names={names}
        result={result}
        onGenerated={(r) => {
          setResult(r);
          setError(null);
          void reload();
          void open(r.schedule.id);
        }}
      />

      <section aria-labelledby="sad-list-title" className="sad-block">
        <h2 id="sad-list-title">Escalas</h2>
        {schedules === null && (
          <p className="status" role="status">
            Carregando…
          </p>
        )}
        {schedules?.length === 0 && <p className="muted">Nenhuma escala criada.</p>}
        <ul className="sad-schedules">
          {schedules?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="btn"
                aria-pressed={detail?.id === s.id}
                onClick={() => {
                  setError(null);
                  void open(s.id);
                }}
              >
                {scheduleLabel(s)}
              </button>
            </li>
          ))}
        </ul>
      </section>

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
    </section>
  );
}
