import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRole } from '../team/TeamContext';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';
import { SCOPES } from './paths';
import type { UnavailabilityMode } from './paths';
import { KIND_LABELS, errorMessage, formatDate, formatPeriod } from './types';
import type { MemberOption, Unavailability, UnavailabilityWarning } from './types';
import './exceptions.css';

type Status = '' | 'past' | 'current' | 'future';
type Loaded = { error: string } | { items: Unavailability[] };

const TEXTS = {
  vacations: {
    title: 'Férias',
    description: 'Férias individuais e coletivas do time.',
    newLabel: 'Novas férias',
    empty: 'Cadastre as férias para a geração da escala não alocar quem estiver ausente.',
    search: 'Buscar por membro, período ou observação',
  },
  member: {
    title: 'Exceções',
    description: 'Períodos em que você não pode ser escalado.',
    newLabel: 'Nova exceção',
    empty: 'Cadastre os períodos em que você não pode ser escalado, como folgas e viagens.',
    search: 'Buscar por período ou observação',
  },
} as const;

/** Data local de hoje (AAAA-MM-DD), para comparar com os períodos. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const statusOf = (i: Unavailability, now: string): Exclude<Status, ''> =>
  i.endDate < now ? 'past' : i.startDate > now ? 'future' : 'current';

/** Listagem das ausências; cadastro, edição e exclusão ficam no formulário (rota própria). */
export function UnavailabilityList({ mode }: { mode: UnavailabilityMode }) {
  const { user } = useAuth();
  const role = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const vacations = mode === 'vacations';
  // No Perfil (mode 'member') a tela é só da própria conta, mesmo para o gestor.
  const showMembers = role === 'manager' && vacations;
  const scope = SCOPES[mode];
  const text = TEXTS[mode];

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [member, setMember] = useState('');

  const warnings: UnavailabilityWarning[] = dismissed
    ? []
    : ((location.state as { warnings?: UnavailabilityWarning[] } | null)?.warnings ?? []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ items: Unavailability[] }>('/api/unavailabilities', controller.signal)
      .then((res) =>
        setLoaded({
          items: res.items.filter((i) =>
            vacations
              ? i.kind === 'vacation' || i.kind === 'collective_vacation'
              : i.kind !== 'collective_vacation' && i.userId === user?.id,
          ),
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ error: errorMessage(err, 'Não foi possível carregar as exceções.') });
      });
    return () => controller.abort();
  }, [vacations, user?.id]);

  useEffect(() => {
    if (!showMembers) return;
    const controller = new AbortController();
    api
      .get<MemberOption[]>('/api/users', controller.signal)
      .then(setMembers)
      .catch(() => undefined);
    return () => controller.abort();
  }, [showMembers]);

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? null;
  const memberLabel = (i: Unavailability) =>
    i.userId ? (nameOf(i.userId) ?? 'Membro') : 'Todo o time';

  const items = useMemo(
    () =>
      loaded && 'items' in loaded
        ? [...loaded.items].sort((a, b) => a.startDate.localeCompare(b.startDate))
        : null,
    [loaded],
  );

  const years = useMemo(
    () =>
      [
        ...new Set((items ?? []).flatMap((i) => [i.startDate.slice(0, 4), i.endDate.slice(0, 4)])),
      ].sort(),
    [items],
  );

  const term = normalizeSearch(search);
  const now = today();
  const visible = (items ?? []).filter((i) => {
    const haystack = `${KIND_LABELS[i.kind]} ${i.note ?? ''} ${formatPeriod(i.startDate, i.endDate)} ${
      showMembers ? memberLabel(i) : ''
    }`;
    return (
      (!term || normalizeSearch(haystack).includes(term)) &&
      (!kind || i.kind === kind) &&
      (!year || (i.startDate.slice(0, 4) <= year && year <= i.endDate.slice(0, 4))) &&
      (!status || statusOf(i, now) === status) &&
      (!member || i.userId === member)
    );
  });

  const clear = () => {
    setSearch('');
    setKind('');
    setYear('');
    setStatus('');
    setMember('');
  };

  const label = (i: Unavailability) =>
    `${KIND_LABELS[i.kind]} ${formatPeriod(i.startDate, i.endDate)}`;

  const cta = (
    <Link to={scope.newPath} className="btn primary">
      {text.newLabel}
    </Link>
  );

  const kindOptions = vacations
    ? (['vacation', 'collective_vacation'] as const)
    : (['time_off', 'other', 'vacation'] as const);

  return (
    <section className="exc-section">
      <PageHeader
        title={text.title}
        description={text.description}
        action={items && items.length > 0 ? cta : undefined}
      />

      {warnings.length > 0 && (
        <div className="exc-warning" role="status" aria-label="Aviso de conflito">
          <ul>
            {warnings.map((w) =>
              w.type === 'published_shifts_affected' ? (
                <li key={`${w.date}:affected`}>
                  {formatDate(w.date)}:{' '}
                  {w.count === 1 ? '1 plantão publicado' : `${w.count} plantões publicados`} neste
                  dia. Ajuste os plantões ou recalcule a escala.
                </li>
              ) : (
                <li key={`${w.date}:${w.userId}`}>
                  Conflito com plantão publicado em {formatDate(w.date)}
                  {nameOf(w.userId) ? ` (${nameOf(w.userId)})` : ''}.{' '}
                  {role === 'manager'
                    ? 'Ajuste a escala, se necessário.'
                    : 'O gestor foi avisado por e-mail.'}
                </li>
              ),
            )}
          </ul>
          <button type="button" className="btn" onClick={() => setDismissed(true)}>
            Dispensar
          </button>
        </div>
      )}

      {loaded === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {loaded !== null && 'error' in loaded && (
        <p className="alert" role="alert">
          {loaded.error}
        </p>
      )}
      {items?.length === 0 && <EmptyState action={cta}>{text.empty}</EmptyState>}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder={text.search}
            onClear={clear}
            clearable={Boolean(search || kind || year || status || member)}
          >
            <select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Todos os tipos</option>
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {vacations ? (k === 'vacation' ? 'Individual' : 'Coletiva') : KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <select aria-label="Ano" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Todos os anos</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              <option value="">Qualquer situação</option>
              <option value="past">Passadas</option>
              <option value="current">Em andamento</option>
              <option value="future">Futuras</option>
            </select>
            {showMembers && (
              <select
                aria-label="Membro"
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                <option value="">Todos os membros</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label={text.title}>
                <thead>
                  <tr>
                    {showMembers && <th scope="col">Membro</th>}
                    <th scope="col">Tipo</th>
                    <th scope="col">Período</th>
                    <th scope="col">Observação</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i) => (
                    <tr
                      key={i.id}
                      onClick={() => void navigate(scope.itemPath(i.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      {showMembers && <td>{memberLabel(i)}</td>}
                      <td>{KIND_LABELS[i.kind]}</td>
                      <td>{formatPeriod(i.startDate, i.endDate)}</td>
                      <td>{i.note ?? ''}</td>
                      <td className="ui-col-actions">
                        <Link
                          to={scope.itemPath(i.id)}
                          className="btn sm"
                          aria-label={`Editar ${label(i)}`}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          Editar
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="ui-count">
            {visible.length} de {items.length} {items.length === 1 ? 'registro' : 'registros'}
          </p>
        </>
      )}
    </section>
  );
}
