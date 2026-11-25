import type { ReactNode } from 'react';
import { TeamAvatar } from './TeamAvatar';
import { useActiveTeam } from './TeamContext';
import './teams.css';
import './page-title.css';

/** Selo com a equipe ativa; nada sem equipe. */
export function TeamTag() {
  const team = useActiveTeam();
  if (!team) return null;
  return (
    <span className="team-tag" title="Equipe selecionada" data-testid="team-tag">
      <TeamAvatar name={team.name} avatar={team.avatar} />
      <span className="sr-only">Equipe: </span>
      {team.name}
    </span>
  );
}

/** Título de página que depende da equipe ativa: mostra a equipe ao lado. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <div className="page-title">
      <h1>{children}</h1>
      <TeamTag />
    </div>
  );
}
