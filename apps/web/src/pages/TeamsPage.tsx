import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTeam } from '../team/TeamContext';
import { TeamAvatar } from '../team/TeamAvatar';
import { TEAMS_NEW_PATH, teamMembersPath, teamPath } from '../team/paths';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar, normalizeSearch } from '../ui/FilterBar';
import { PageHeader } from '../ui/PageHeader';
import '../team/teams.css';

type DashboardFilter = '' | 'with' | 'without';

/** Listagem das equipes; cadastro, edição e exclusão ficam no formulário. */
export function TeamsPage() {
  const navigate = useNavigate();
  const { teams, activeTeam, loading } = useTeam();
  const [search, setSearch] = useState('');
  const [dashboard, setDashboard] = useState<DashboardFilter>('');

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return teams.filter(
      (t) =>
        (!term || normalizeSearch(t.name).includes(term)) &&
        (!dashboard || (dashboard === 'with') === Boolean(t.dashboardUrl)),
    );
  }, [teams, search, dashboard]);

  const clear = () => {
    setSearch('');
    setDashboard('');
  };

  const cta = (
    <Link to={TEAMS_NEW_PATH} className="btn primary">
      Nova equipe
    </Link>
  );

  return (
    <section>
      <PageHeader
        title="Equipes"
        description="Dados, dashboard e membros de cada equipe."
        action={teams.length > 0 ? cta : undefined}
      />
      {loading && teams.length === 0 && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {!loading && teams.length === 0 && (
        <EmptyState action={cta}>Nenhuma equipe cadastrada. Crie a primeira equipe.</EmptyState>
      )}
      {teams.length > 0 && (
        <>
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Buscar por nome"
            onClear={clear}
            clearable={Boolean(search || dashboard)}
          >
            <select
              aria-label="Dashboard"
              value={dashboard}
              onChange={(e) => setDashboard(e.target.value as DashboardFilter)}
            >
              <option value="">Com ou sem dashboard</option>
              <option value="with">Com dashboard</option>
              <option value="without">Sem dashboard</option>
            </select>
          </FilterBar>
          {visible.length === 0 ? (
            <p className="muted">Nenhum registro encontrado para os filtros aplicados.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table" aria-label="Equipes">
                <thead>
                  <tr>
                    <th scope="col">Equipe</th>
                    <th scope="col">Dashboard</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => void navigate(teamPath(t.id))}
                      style={{ cursor: 'pointer' }}
                    >
                      <th scope="row">
                        <span className="teams-name-cell">
                          <TeamAvatar name={t.name} avatar={t.avatar} size="lg" />
                          <span>{t.name}</span>
                          {t.id === activeTeam?.id && (
                            <span className="teams-badge">Em exibição</span>
                          )}
                        </span>
                      </th>
                      <td>
                        {t.dashboardUrl ? (
                          <a
                            href={t.dashboardUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Abrir dashboard de ${t.name}`}
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            Abrir dashboard
                          </a>
                        ) : (
                          <span className="muted">Sem dashboard</span>
                        )}
                      </td>
                      <td className="ui-col-actions">
                        <Link
                          to={teamMembersPath(t.id)}
                          className="btn sm"
                          aria-label={`Membros de ${t.name}`}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          Membros
                        </Link>{' '}
                        <Link
                          to={teamPath(t.id)}
                          className="btn sm"
                          aria-label={`Editar ${t.name}`}
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
            {visible.length} de {teams.length} {teams.length === 1 ? 'registro' : 'registros'}
          </p>
        </>
      )}
    </section>
  );
}
