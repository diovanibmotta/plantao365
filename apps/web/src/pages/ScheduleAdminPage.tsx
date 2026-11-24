import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { GenerateForm } from '../schedule-admin/GenerateForm';
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

type StatusFilter = '' | ScheduleDto['status'];

export function ScheduleAdminPage() {
  const [schedules, setSchedules] = useState<ScheduleDto[] | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [onDate, setOnDate] = useState('');
  const [toDelete, setToDelete] = useState<ScheduleDto | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const remove = async (s: ScheduleDto): Promise<void> => {
    setDeleting(true);
    try {
      await api.delete(`/api/schedules/${s.id}`);
      if (detail?.id === s.id) {
        setDetail(null);
        setResult(null);
      }
      await reload();
    } catch (err) {
      setError(describe(err, 'Não foi possível excluir a escala.'));
    } finally {
      setToDelete(null);
      setDeleting(false);
    }
  };

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  // Datas ISO (AAAA-MM-DD) comparam corretamente como string.
  const filtered = (schedules ?? []).filter(
    (s) =>
      (!status || s.status === status) &&
      (!onDate || (s.startDate <= onDate && onDate <= s.endDate)),
  );

  return (
    <section>
      <h1>Escala</h1>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <ShiftSettingsForm />
      <WorkHoursForm />

      <section aria-labelledby="sad-list-title" className="sad-block">
        <h2 id="sad-list-title">Pesquisar escalas</h2>
        <div className="sad-row" role="search">
          <label>
            Situação
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
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
                    <td>{s.status === 'draft' ? 'Rascunho' : 'Publicada'}</td>
                    <td className="sad-actions">
                      <button
                        type="button"
                        className="btn"
                        aria-pressed={detail?.id === s.id}
                        aria-label={`Alterar escala de ${period}`}
                        onClick={() => {
                          setError(null);
                          void open(s.id);
                        }}
                      >
                        Alterar
                      </button>
                      {/* Backend só exclui rascunho: publicada tem trocas/saldo vinculados. */}
                      {s.status === 'draft' && (
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Excluir escala de ${period}`}
                          onClick={() => setToDelete(s)}
                        >
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {toDelete && (
          <div className="sad-confirm" role="alertdialog" aria-label="Confirmar exclusão">
            <p>
              Excluir o rascunho de {formatDate(toDelete.startDate)} a{' '}
              {formatDate(toDelete.endDate)}? Esta ação não pode ser desfeita.
            </p>
            <div className="sad-row">
              <button
                type="button"
                className="btn primary"
                disabled={deleting}
                onClick={() => void remove(toDelete)}
              >
                Confirmar exclusão
              </button>
              <button type="button" className="btn" onClick={() => setToDelete(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

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
