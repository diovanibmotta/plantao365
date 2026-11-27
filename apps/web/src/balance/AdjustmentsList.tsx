import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import {
  EmptyState,
  FilterBar,
  normalizeSearch,
  PageHeader,
  Pagination,
  usePagination,
} from '@diovanibmotta/plantao365-web-sdk';
import { Diff } from './Diff';
import { formatDate } from './format';
import { ADJUSTMENTS_NEW_PATH, adjustmentPath } from './paths';
import type { Adjustment, TeamBalanceData } from './types';

type SignFilter = '' | 'positive' | 'negative';

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

interface Loaded {
  year: number;
  items: Adjustment[];
  names: Map<string, string>;
}

/** Listagem dos ajustes manuais de horas do ano; cadastro e exclusão ficam no formulário. */
export function AdjustmentsList({ year }: { year: number }) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{ year: number; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [member, setMember] = useState('');
  const [month, setMonth] = useState('');
  const [sign, setSign] = useState<SignFilter>('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<{ items: Adjustment[] }>(`/api/balance/adjustments?year=${year}`, controller.signal),
      api.get<TeamBalanceData>(`/api/balance?year=${year}`, controller.signal),
    ])
      .then(([list, team]) =>
        setLoaded({
          year,
          items: list.items,
          names: new Map(team.members.map((m) => [m.userId, m.name])),
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setFailed({
          year,
          message: err instanceof Error ? err.message : 'Não foi possível carregar os ajustes.',
        });
      });
    return () => controller.abort();
  }, [year]);

  const data = loaded?.year === year ? loaded : null;
  const error = failed?.year === year ? failed.message : null;
  const items = data?.items ?? null;
  const nameOf = (id: string) => data?.names.get(id) ?? '—';

  const members = useMemo(
    () =>
      [...new Set((items ?? []).map((a) => a.userId))]
        .map((id) => ({ id, name: data?.names.get(id) ?? '—' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [items, data],
  );

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (items ?? [])
      .filter(
        (a) =>
          (!term ||
            normalizeSearch(`${data?.names.get(a.userId) ?? ''} ${a.reason}`).includes(term)) &&
          (!member || a.userId === member) &&
          (!month || a.date.slice(5, 7) === month) &&
          (!sign || (sign === 'positive') === a.hours > 0),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [items, data, search, member, month, sign]);

  const pager = usePagination(visible, [search, member, month, sign].join('|'));
  const clear = () => {
    setSearch('');
    setMember('');
    setMonth('');
    setSign('');
  };

  const cta = (
    <Link to={ADJUSTMENTS_NEW_PATH} className="btn primary">
      Novo ajuste
    </Link>
  );

  return (
    <section>
      <PageHeader
        title="Ajustes de saldo"
        description={`Correções manuais de horas lançadas em ${year}.`}
        action={items && items.length > 0 ? cta : undefined}
      />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {items?.length === 0 && (
        <EmptyState action={cta}>
          Nenhum ajuste em {year}. Lance um ajuste para corrigir o saldo de um membro.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por membro ou motivo"
            onClear={clear}
            clearable={Boolean(search || member || month || sign)}
          >
            <select aria-label="Membro" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Todos os membros</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select aria-label="Mês" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Todos os meses</option>
              {MONTHS.map((name, i) => (
                <option key={name} value={String(i + 1).padStart(2, '0')}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Sinal"
              value={sign}
              onChange={(e) => setSign(e.target.value as SignFilter)}
            >
              <option value="">Positivos e negativos</option>
              <option value="positive">Positivos</option>
              <option value="negative">Negativos</option>
            </select>
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label={`Ajustes de saldo em ${year}`}>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Membro</th>
                    <th scope="col" className="bal-r">
                      Horas
                    </th>
                    <th scope="col">Motivo</th>
                    <th scope="col">Lançado por</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((a) => (
                    <tr
                      key={a.id}
                      data-testid="bal-adjustment"
                      onClick={() => void navigate(adjustmentPath(a.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{formatDate(a.date)}</td>
                      <td>{nameOf(a.userId)}</td>
                      <td className="bal-r">
                        <Diff value={a.hours} />
                      </td>
                      <td>{a.reason}</td>
                      <td>{nameOf(a.createdBy)}</td>
                      <td className="ui-col-actions">
                        <Link
                          to={adjustmentPath(a.id)}
                          className="btn sm"
                          aria-label={`Abrir ajuste de ${nameOf(a.userId)} em ${formatDate(a.date)}`}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            total={items.length}
            filtered={visible.length}
            page={pager.page}
            pages={pager.pages}
            pageSize={pager.pageSize}
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </>
      )}
    </section>
  );
}
