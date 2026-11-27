import { Link, useParams } from 'react-router';
import { useTeam } from './TeamContext';
import { TeamMembersPanel } from './TeamMembersPanel';
import { TEAMS_PATH, teamPath } from './paths';
import { Breadcrumb } from '@diovanibmotta/plantao365-web-sdk';
import './teams.css';

/** Gestão dos membros de uma equipe, acessada a partir da listagem ou do formulário. */
export function TeamMembersPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { teams, loading } = useTeam();
  const team = teams.find((t) => t.id === id);
  if (loading && !team) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  if (!team) {
    return (
      <section>
        <Breadcrumb crumbs={[{ label: 'Equipes', to: TEAMS_PATH }, { label: 'Membros' }]} />
        <p className="alert" role="alert">
          Equipe não encontrada.
        </p>
        <Link to={TEAMS_PATH}>Voltar para a listagem</Link>
      </section>
    );
  }
  return (
    <section>
      <Breadcrumb
        crumbs={[
          { label: 'Equipes', to: TEAMS_PATH },
          { label: team.name, to: teamPath(team.id) },
          { label: 'Membros' },
        ]}
      />
      <div className="ui-form-head">
        <h2>Membros de {team.name}</h2>
        <p>Papel e rodízio são definidos por equipe.</p>
      </div>
      <TeamMembersPanel teamId={team.id} teamName={team.name} />
    </section>
  );
}
