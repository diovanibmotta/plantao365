import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { describeError } from '../members/types';

interface TeamMember {
  id: string;
  name: string;
  email: string;
}

interface Props {
  teamId: string;
  teamName: string;
}

/** Membros de uma equipe: lista, desvincula e vincula usuários já cadastrados. */
export function TeamMembersPanel({ teamId, teamName }: Props) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [candidates, setCandidates] = useState<TeamMember[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get<TeamMember[]>(`/api/teams/${teamId}/members`, controller.signal),
      api.get<TeamMember[]>('/api/users', controller.signal),
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

  const available = candidates.filter((u) => !members?.some((m) => m.id === u.id));

  async function link() {
    const user = available.find((u) => u.id === selected);
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/teams/${teamId}/members/${user.id}`);
      setMembers((prev) => [...(prev ?? []), user]);
      setSelected('');
    } catch (err) {
      setError(describeError(err, 'Não foi possível vincular o membro.'));
    } finally {
      setBusy(false);
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
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-label={`Desvincular ${m.name} de ${teamName}`}
                onClick={() => void unlink(m)}
              >
                Desvincular
              </button>
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
