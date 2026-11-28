import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useActiveTeam } from '../team/TeamContext';
import { toast } from '../toast/toast-store';
import { FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { SCHEDULE_ADMIN_PATH, schedulePath, tabPath } from './paths';
import {
  CSV_FIELDS,
  DEFAULT_CSV_KEYS,
  buildCsv,
  csvFields,
  downloadFile,
  reportContext,
  reportFileName,
} from './schedule-report';
import type { CsvFieldKey } from './schedule-report';
import { describe, formatDate } from './types';
import type { MemberOption, ScheduleDetail } from './types';

interface FieldState {
  key: CsvFieldKey;
  on: boolean;
}

const defaultFields = (): FieldState[] =>
  CSV_FIELDS.map((f) => ({ key: f.key, on: DEFAULT_CSV_KEYS.includes(f.key) }));

const labelOf = (key: CsvFieldKey) => CSV_FIELDS.find((f) => f.key === key)?.label ?? key;

const PREVIEW_ROWS = 5;

/** Exportação da escala em CSV: o gestor escolhe os campos e a ordem das colunas. */
export function ScheduleCsvExport() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const team = useActiveTeam();
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldState[]>(defaultFields);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<ScheduleDetail>(`/api/schedules/${id}`, controller.signal)
      .then(setDetail)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(describe(err, 'Não foi possível abrir a escala.'));
      });
    // Só para o nome do gestor; sem a lista, o relatório usa os gestores da equipe.
    api
      .get<MemberOption[]>('/api/users', controller.signal)
      .then(setMembers)
      .catch(() => undefined);
    return () => controller.abort();
  }, [id]);

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const keys = fields.filter((f) => f.on).map((f) => f.key);
  const back = () => void navigate(schedulePath(id));

  if (error || !detail) {
    return error ? (
      <section>
        <p className="alert" role="alert">
          {error}
        </p>
        <button type="button" className="btn" onClick={() => void navigate(tabPath('schedules'))}>
          Voltar para a listagem
        </button>
      </section>
    ) : (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  const ctx = reportContext(detail, names, team);
  const period = `${formatDate(detail.startDate)} a ${formatDate(detail.endDate)}`;
  const columns = csvFields(keys);
  const positions = new Map(keys.map((k, i) => [k, i + 1]));

  const move = (index: number, delta: number) =>
    setFields((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });

  const toggle = (key: CsvFieldKey, on: boolean) =>
    setFields((current) => current.map((f) => (f.key === key ? { ...f, on } : f)));

  const download = () => {
    if (keys.length === 0) return;
    downloadFile(
      new Blob([buildCsv(detail, keys, ctx)], { type: 'text/csv;charset=utf-8' }),
      reportFileName(detail, ctx, 'csv'),
    );
    toast.success('CSV da escala gerado.');
    back();
  };

  return (
    <FormPage
      crumbs={[
        { label: 'Escala', to: SCHEDULE_ADMIN_PATH },
        { label: 'Escalas', to: tabPath('schedules') },
        { label: period, to: schedulePath(id) },
        { label: 'Exportar CSV' },
      ]}
      title="Exportar CSV"
      description="Escolha os campos e a ordem das colunas. O arquivo usa ponto e vírgula e abre direto no Excel."
      onSubmit={download}
    >
      <FormSection
        title="Campos"
        description="Marque os campos e use as setas para ordenar as colunas."
      >
        <ol className="sad-csv-fields" aria-label="Campos do CSV">
          {fields.map((f, i) => {
            const label = labelOf(f.key);
            return (
              <li key={f.key} className={f.on ? undefined : 'sad-csv-field--off'}>
                <span className="sad-csv-pos" aria-hidden="true">
                  {positions.get(f.key) ?? ''}
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={f.on}
                    onChange={(e) => toggle(f.key, e.target.checked)}
                  />
                  {label}
                </label>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Mover ${label} para cima`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Mover ${label} para baixo`}
                  disabled={i === fields.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>
        <div className="sad-row">
          <button
            type="button"
            className="btn"
            onClick={() => setFields((c) => c.map((f) => ({ ...f, on: true })))}
          >
            Marcar todos
          </button>
          <button type="button" className="btn" onClick={() => setFields(defaultFields())}>
            Restaurar padrão
          </button>
        </div>
        {keys.length === 0 && (
          <p className="alert" role="alert">
            Selecione ao menos um campo.
          </p>
        )}
      </FormSection>
      <FormSection
        title="Prévia"
        description={`Primeiras linhas de ${detail.shifts.length} · ${reportFileName(detail, ctx, 'csv')}`}
      >
        {keys.length > 0 && (
          <div className="ui-table-wrap">
            <table className="ui-table" aria-label="Prévia do CSV">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.shifts.slice(0, PREVIEW_ROWS).map((s) => (
                  <tr key={s.id}>
                    {columns.map((c) => (
                      <td key={c.key}>{c.value(s, detail, ctx)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>
      <FormActions
        busy={false}
        onCancel={back}
        saveLabel="Baixar CSV"
        saveDisabled={keys.length === 0}
      />
    </FormPage>
  );
}
