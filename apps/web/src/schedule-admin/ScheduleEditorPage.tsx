import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useActiveTeam } from '../team/TeamContext';
import { ScheduleEditor } from './ScheduleEditor';
import { GenerateReport } from './GenerateReport';
import { tabPath } from './paths';
import { reportContext } from './schedule-report';
import { describe } from './types';
import type { GenerateResult, MemberOption, ScheduleDetail } from './types';

/** Abre uma escala: relatório da geração (quando recém-gerada), plantões, publicar e descartar. */
export function ScheduleEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const result = (location.state as { result?: GenerateResult } | null)?.result;
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const team = useActiveTeam();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setDetail(await api.get<ScheduleDetail>(`/api/schedules/${id}`, signal));
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    const fail = (err: unknown, fallback: string) => {
      if (!controller.signal.aborted) setError(describe(err, fallback));
    };
    api
      .get<ScheduleDetail>(`/api/schedules/${id}`, controller.signal)
      .then(setDetail)
      .catch((err: unknown) => fail(err, 'Não foi possível abrir a escala.'));
    api
      .get<MemberOption[]>('/api/users', controller.signal)
      .then(setMembers)
      .catch((err: unknown) => fail(err, 'Não foi possível carregar a equipe.'));
    return () => controller.abort();
  }, [id]);

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const back = () => void navigate(tabPath('schedules'));

  if (error) {
    return (
      <section>
        <p className="alert" role="alert">
          {error}
        </p>
        <button type="button" className="btn" onClick={back}>
          Voltar para a listagem
        </button>
      </section>
    );
  }
  if (!detail) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  return (
    <>
      {result && result.schedule.id === detail.id && (
        <GenerateReport names={names} result={result} />
      )}
      <ScheduleEditor
        key={detail.id}
        schedule={detail}
        members={members}
        report={reportContext(detail, names, team)}
        onChanged={() => {
          load().catch((err: unknown) =>
            setError(describe(err, 'Não foi possível abrir a escala.')),
          );
        }}
        onDiscarded={back}
        onBack={back}
      />
    </>
  );
}
