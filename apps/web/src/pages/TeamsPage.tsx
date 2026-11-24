import { useState } from 'react';
import { useTeam } from '../team/TeamContext';
import '../team/teams.css';

type Editing = { mode: 'create' } | { mode: 'edit'; id: string; name: string } | null;

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function TeamsPage() {
  const { teams, activeTeam, create, rename, remove } = useTeam();
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: Editing) {
    setEditing(next);
    setName(next?.mode === 'edit' ? next.name : '');
    setRemovingId(null);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !editing) return;
    setBusy(true);
    setError(null);
    try {
      if (editing.mode === 'create') await create(trimmed);
      else await rename(editing.id, trimmed);
      open(null);
    } catch (err) {
      setError(message(err, 'Não foi possível salvar a equipe.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await remove(id);
      setRemovingId(null);
    } catch (err) {
      setError(message(err, 'Não foi possível excluir a equipe.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="teams-header">
        <h1>Equipes</h1>
        <button
          type="button"
          className="btn primary"
          disabled={editing !== null}
          onClick={() => open({ mode: 'create' })}
        >
          Nova equipe
        </button>
      </div>

      {editing && (
        <form className="teams-form" onSubmit={(e) => void save(e)}>
          <label>
            Nome da equipe
            <input
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="teams-actions">
            <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => open(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {teams.length === 0 ? (
        <p className="status muted">Nenhuma equipe cadastrada.</p>
      ) : (
        <ul className="teams-list" aria-label="Equipes">
          {teams.map((t) => (
            <li key={t.id} className="teams-item">
              <span className="teams-name">
                {t.name}
                {t.id === activeTeam?.id && <span className="teams-badge">Em exibição</span>}
              </span>
              {removingId === t.id ? (
                <div className="teams-actions" role="group" aria-label={`Excluir ${t.name}`}>
                  <span>Excluir “{t.name}”?</span>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void confirmRemove(t.id)}
                  >
                    Confirmar exclusão
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setRemovingId(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="teams-actions">
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Editar ${t.name}`}
                    onClick={() => open({ mode: 'edit', id: t.id, name: t.name })}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Excluir ${t.name}`}
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                      setRemovingId(t.id);
                    }}
                  >
                    Excluir
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
