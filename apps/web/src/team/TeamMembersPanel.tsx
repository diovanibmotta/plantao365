import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { describeError, ROLE_OPTIONS } from '../members/types';
import type { TeamRole } from '../members/types';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: TeamRole;
  participatesInRotation: boolean;
}

interface Candidate {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

interface Props {
  teamId: string;
  teamName: string;
}

/** Membros de uma equipe: papel e rodízio são definidos aqui, por equipe. */
export function TeamMembersPanel({ teamId, teamName }: Props) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState('');
  const [newRole, setNewRole] = useState<TeamRole>('member');
  const [newParticipates, setNewParticipates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<TeamMember[]>(`/api/teams/${teamId}/members`, controller.signal),
      api.get<Candidate[]>('/api/users', controller.signal),
    ])
      .then(([list, users]) => {
        setMembers(list);
        setCandidates(users);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setMembers([]);
        setError(describeError(err, 'Não foi possível carregar os membros da equipe.'));
      });
    return () => controller.abort();
  }, [teamId]);

  const available = candidates.filter((u) => u.active && !members?.some((m) => m.id === u.id));

  async function save(userId: string, body: { role?: TeamRole; participatesInRotation?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.put<TeamMember>(`/api/teams/${teamId}/members/${userId}`, body);
      setMembers((prev) => {
        const rest = (prev ?? []).filter((m) => m.id !== userId);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      });
      return true;
    } catch (err) {
      setError(describeError(err, 'Não foi possível salvar o membro.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    if (!selected) return;
    if (await save(selected, { role: newRole, participatesInRotation: newParticipates })) {
      setSelected('');
    }
  }

  async function unlink(user: TeamMember) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/teams/${teamId}/members/${user.id}`);
      setMembers((prev) => (prev ?? []).filter((m) => m.id !== user.id));
    } catch (err) {
      setError(describeError(err, 'Não foi possível desvincular o membro.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="teams-members" role="group" aria-label={`Membros de ${teamName}`}>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {members === null ? (
        <p className="status muted">Carregando…</p>
      ) : members.length === 0 ? (
        <p className="status muted">Nenhum membro vinculado.</p>
      ) : (
        <ul className="teams-members-list">
          {members.map((m) => (
            <li key={m.id}>
              <span>
                {m.name} <span className="muted">{m.email}</span>
                {!m.active && <span className="muted"> (inativo)</span>}
              </span>
              <span className="teams-member-controls">
                <select
                  aria-label={`Papel de ${m.name} em ${teamName}`}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => void save(m.id, { role: e.target.value as TeamRole })}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <label className="members-check">
                  <input
                    type="checkbox"
                    aria-label={`Participa do rodízio: ${m.name}`}
                    checked={m.participatesInRotation}
                    disabled={busy}
                    onChange={(e) => void save(m.id, { participatesInRotation: e.target.checked })}
                  />
                  Rodízio
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  aria-label={`Desvincular ${m.name} de ${teamName}`}
                  onClick={() => void unlink(m)}
                >
                  Desvincular
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="teams-actions">
          <select
            aria-label={`Adicionar membro a ${teamName}`}
            value={selected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Selecione um membro…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <select
            aria-label="Papel do novo membro"
            value={newRole}
            disabled={busy}
            onChange={(e) => {
              const role = e.target.value as TeamRole;
              setNewRole(role);
              setNewParticipates(role === 'member');
            }}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="members-check">
            <input
              type="checkbox"
              aria-label="Novo membro participa do rodízio"
              checked={newParticipates}
              disabled={busy}
              onChange={(e) => setNewParticipates(e.target.checked)}
            />
            Rodízio
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !selected}
            aria-label={`Vincular a ${teamName}`}
            onClick={() => void link()}
          >
            Vincular
          </button>
        </div>
      )}
    </div>
  );
}
