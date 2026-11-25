import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useManageableTeams } from '../team/TeamContext';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';
import { MEMBERS_NEW_PATH, memberPath } from './paths';
import { describeError, sortMembers } from './types';
import type { Member } from './types';
import './members.css';

type StatusFilter = '' | 'active' | 'inactive';
type AccessFilter = '' | 'pending' | 'linked';

/** Listagem de membros; pré-cadastro, edição e desativação ficam no formulário. */
export function MembersList() {
  const navigate = useNavigate();
  const teams = useManageableTeams();
  const [items, setItems] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [access, setAccess] = useState<AccessFilter>('');
  const [team, setTeam] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Member[]>('/api/users', controller.signal)
      .then((members) => setItems(sortMembers(members)))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeError(err, 'Não foi possível carregar os membros.'));
        }
      });
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return (items ?? []).filter(
      (m) =>
        (!term || normalizeSearch(`${m.name} ${m.email}`).includes(term)) &&
        (!status || (status === 'active') === m.active) &&
        (!access || (access === 'linked') === m.linked) &&
        (!team || (team === 'none' ? m.teamIds.length === 0 : m.teamIds.includes(team))),
    );
  }, [items, search, status, access, team]);

  const clear = () => {
    setSearch('');
    setStatus('');
    setAccess('');
    setTeam('');
  };

  const cta = (
    <Link to={MEMBERS_NEW_PATH} className="btn primary">
      Novo membro
    </Link>
  );

  return (
    <section>
      <PageHeader
        title="Membros"
        description="Pessoas cadastradas, o acesso e as equipes de cada uma."
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
          Pré-cadastre os membros para que, no primeiro acesso, a pessoa já entre com o papel da
          equipe.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome ou e-mail"
            onClear={clear}
            clearable={Boolean(search || status || access || team)}
          >
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="">Qualquer situação</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
            <select
              aria-label="Acesso"
              value={access}
              onChange={(e) => setAccess(e.target.value as AccessFilter)}
            >
              <option value="">Qualquer acesso</option>
              <option value="pending">Aguardando primeiro acesso</option>
              <option value="linked">Já acessou</option>
            </select>
            <select aria-label="Equipe" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Todas as equipes</option>
              <option value="none">Sem equipe</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Membros">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">E-mail</th>
                    <th scope="col">Situação</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => (
                    <tr
                      key={m.id}
                      className={m.active ? undefined : 'members-inactive'}
                      onClick={() => void navigate(memberPath(m.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        {m.name}
                        {!m.linked && (
                          <span className="members-badge">Aguardando primeiro acesso</span>
                        )}
                        {m.teamIds.length === 0 && (
                          <span className="members-badge">Sem equipe</span>
                        )}
                      </td>
                      <td>{m.email}</td>
                      <td>{m.active ? 'Ativo' : 'Inativo'}</td>
                      <td className="ui-col-actions">
                        <Link
                          to={memberPath(m.id)}
                          className="btn sm"
                          aria-label={`Editar ${m.name}`}
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
