import { useState } from 'react';
import { useTeam } from '../team/TeamContext';
import type { Team, TeamInput } from '../team/TeamContext';
import { AVATAR_OPTIONS, TeamAvatar } from '../team/TeamAvatar';
import { TeamMembersPanel } from '../team/TeamMembersPanel';
import '../team/teams.css';

type Editing = { mode: 'create' } | { mode: 'edit'; team: Team } | null;
type Tab = 'data' | 'members';

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const URL_PATTERN = /^https?:\/\/\S+$/i;

export function TeamsPage() {
  const { teams, activeTeam, create, update, remove } = useTeam();
  const [editing, setEditing] = useState<Editing>(null);
  const [tab, setTab] = useState<Tab>('data');
  const [name, setName] = useState('');
  const [dashboardUrl, setDashboardUrl] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(next: Editing, nextTab: Tab = 'data') {
    setEditing(next);
    setTab(nextTab);
    const team = next?.mode === 'edit' ? next.team : null;
    setName(team?.name ?? '');
    setDashboardUrl(team?.dashboardUrl ?? '');
    setAvatar(team?.avatar ?? null);
    setRemoving(false);
    setError(null);
    setNotice(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const url = dashboardUrl.trim();
    if (!trimmed || !editing) return;
    if (url && !URL_PATTERN.test(url)) {
      setError('Informe uma URL válida, começando com http:// ou https://.');
      return;
    }
    const input: TeamInput = { name: trimmed, dashboardUrl: url || null, avatar };
    setBusy(true);
    setError(null);
    try {
      if (editing.mode === 'create') {
        const created = await create(input);
        open({ mode: 'edit', team: created }, 'members');
        setNotice('Equipe criada. Vincule os membros abaixo.');
      } else {
        const saved = await update(editing.team.id, input);
        setEditing({ mode: 'edit', team: saved });
        setNotice('Equipe salva.');
      }
    } catch (err) {
      setError(message(err, 'Não foi possível salvar a equipe.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (editing?.mode !== 'edit') return;
    setBusy(true);
    setError(null);
    try {
      await remove(editing.team.id);
      open(null);
    } catch (err) {
      setError(message(err, 'Não foi possível excluir a equipe.'));
      setRemoving(false);
    } finally {
      setBusy(false);
    }
  }

  const editingId = editing?.mode === 'edit' ? editing.team.id : null;

  return (
    <section>
      <div className="teams-header">
        <div>
          <h1>Equipes</h1>
          <p className="muted teams-lead">Dados, dashboard e membros de cada equipe.</p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={editing?.mode === 'create'}
          onClick={() => open({ mode: 'create' })}
        >
          Nova equipe
        </button>
      </div>

      {error && editing === null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {teams.length === 0 && editing === null ? (
        <p className="status muted">Nenhuma equipe cadastrada.</p>
      ) : (
        <ul className="teams-grid" aria-label="Equipes">
          {teams.map((t) => (
            <li
              key={t.id}
              className={`teams-card${t.id === editingId ? ' teams-card-selected' : ''}`}
            >
              <TeamAvatar name={t.name} avatar={t.avatar} size="lg" />
              <div className="teams-card-body">
                <span className="teams-name">
                  {t.name}
                  {t.id === activeTeam?.id && <span className="teams-badge">Em exibição</span>}
                </span>
                {t.dashboardUrl ? (
                  <a
                    href={t.dashboardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir dashboard de ${t.name}`}
                  >
                    Abrir dashboard
                  </a>
                ) : (
                  <span className="muted">Sem dashboard</span>
                )}
              </div>
              <button
                type="button"
                className="btn"
                aria-label={`Gerenciar ${t.name}`}
                onClick={() => open({ mode: 'edit', team: t })}
              >
                Gerenciar
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="teams-editor">
          <div className="teams-editor-head">
            <TeamAvatar name={name || 'Nova'} avatar={avatar} size="lg" />
            <h2>{editing.mode === 'create' ? 'Nova equipe' : editing.team.name}</h2>
            <button type="button" className="btn" onClick={() => open(null)}>
              Fechar
            </button>
          </div>

          <div className="teams-tabs" role="tablist" aria-label="Seções da equipe">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'data'}
              className="teams-tab"
              onClick={() => setTab('data')}
            >
              Dados
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'members'}
              className="teams-tab"
              disabled={editing.mode === 'create'}
              onClick={() => setTab('members')}
            >
              Membros
            </button>
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="members-message" role="status">
              {notice}
            </p>
          )}

          {tab === 'data' && (
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
              <label>
                URL do dashboard
                <input
                  type="url"
                  value={dashboardUrl}
                  maxLength={500}
                  placeholder="https://"
                  onChange={(e) => setDashboardUrl(e.target.value)}
                />
              </label>
              <fieldset className="teams-avatars">
                <legend>Ícone</legend>
                <div className="teams-avatar-options">
                  {AVATAR_OPTIONS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="teams-avatar-option"
                      aria-label={`Ícone ${a}`}
                      aria-pressed={avatar === a}
                      onClick={() => setAvatar(avatar === a ? null : a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="teams-actions">
                <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
                  {busy ? 'Salvando…' : 'Salvar'}
                </button>
                {editing.mode === 'edit' &&
                  (removing ? (
                    <div className="teams-actions" role="group" aria-label="Confirmar exclusão">
                      <span>Excluir “{editing.team.name}”?</span>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void confirmRemove()}
                      >
                        Confirmar exclusão
                      </button>
                      <button type="button" className="btn" onClick={() => setRemoving(false)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn" onClick={() => setRemoving(true)}>
                      Excluir equipe
                    </button>
                  ))}
              </div>
            </form>
          )}

          {tab === 'members' && editing.mode === 'edit' && (
            <TeamMembersPanel
              key={editing.team.id}
              teamId={editing.team.id}
              teamName={editing.team.name}
            />
          )}
        </div>
      )}
    </section>
  );
}
