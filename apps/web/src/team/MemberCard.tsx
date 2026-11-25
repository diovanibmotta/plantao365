import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { KIND_LABELS, WEEKDAYS, formatPeriod } from '../exceptions/types';
import type { ExceptionKind } from '../exceptions/types';
import { Avatar } from '../layout/Avatar';
import { describeError, ROLE_OPTIONS } from '../members/types';
import type { TeamRole } from '../members/types';

interface MemberProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  badgeNumber: string | null;
  active: boolean;
  role: TeamRole;
  participatesInRotation: boolean;
  preferences: { avoidWeekdays: number[]; maxConsecutiveShifts: number | null };
  unavailabilities: {
    id: string;
    kind: ExceptionKind;
    startDate: string;
    endDate: string;
    note: string | null;
  }[];
}

interface Props {
  teamId: string;
  userId: string;
}

/** Cartão de visita do membro para o gestor: foto, contatos, preferências e exceções. */
export function MemberCard({ teamId, userId }: Props) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<MemberProfile>(`/api/teams/${teamId}/members/${userId}`, controller.signal)
      .then(setProfile)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(describeError(err, 'Não foi possível carregar o perfil do membro.'));
      });
    return () => controller.abort();
  }, [teamId, userId]);

  if (error) {
    return (
      <p className="alert" role="alert">
        {error}
      </p>
    );
  }
  if (!profile) return <p className="status muted">Carregando…</p>;

  const { preferences: prefs } = profile;
  const roleLabel = ROLE_OPTIONS.find((o) => o.value === profile.role)?.label ?? profile.role;
  return (
    <article className="member-card" aria-label={`Perfil de ${profile.name}`}>
      <header className="member-card-header">
        <Avatar userId={profile.id} name={profile.name} className="avatar member-card-avatar" />
        <div>
          <strong>{profile.name}</strong>
          <div className="muted">
            {roleLabel}
            {profile.participatesInRotation ? ' · participa do rodízio' : ' · fora do rodízio'}
            {!profile.active && ' · inativo'}
          </div>
        </div>
      </header>
      <dl className="member-card-facts">
        <dt>E-mail</dt>
        <dd>
          <a href={`mailto:${profile.email}`}>{profile.email}</a>
        </dd>
        <dt>Crachá</dt>
        <dd>{profile.badgeNumber ?? <span className="muted">Não informado</span>}</dd>
        <dt>Telefone</dt>
        <dd>
          {profile.phone ? (
            <a href={`tel:${profile.phone.replace(/[^\d+]/g, '')}`}>{profile.phone}</a>
          ) : (
            <span className="muted">Não informado</span>
          )}
        </dd>
        <dt>Evita plantão</dt>
        <dd>
          {prefs.avoidWeekdays.length > 0 ? (
            prefs.avoidWeekdays.map((d) => WEEKDAYS[d]).join(', ')
          ) : (
            <span className="muted">Sem preferência</span>
          )}
        </dd>
        <dt>Máx. consecutivos</dt>
        <dd>{prefs.maxConsecutiveShifts ?? <span className="muted">Sem limite</span>}</dd>
        <dt>Exceções</dt>
        <dd>
          {profile.unavailabilities.length > 0 ? (
            <ul className="member-card-exceptions">
              {profile.unavailabilities.map((u) => (
                <li key={u.id}>
                  {KIND_LABELS[u.kind]}: {formatPeriod(u.startDate, u.endDate)}
                  {u.note && <span className="muted"> — {u.note}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">Nenhuma exceção futura</span>
          )}
        </dd>
      </dl>
    </article>
  );
}
