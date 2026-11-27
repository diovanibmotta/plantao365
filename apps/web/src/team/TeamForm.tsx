import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTeam } from './TeamContext';
import type { TeamInput } from './TeamContext';
import { AVATAR_OPTIONS, TeamAvatar } from './TeamAvatar';
import { TEAMS_PATH, teamMembersPath } from './paths';
import {
  ConfirmDialog,
  FormActions,
  FormPage,
  FormSection,
} from '@diovanibmotta/plantao365-web-sdk';
import './teams.css';

const URL_PATTERN = /^https?:\/\/\S+$/i;
const URL_MESSAGE = 'Informe uma URL válida, começando com http:// ou https://.';

/** Cadastro, edição e exclusão de uma equipe; os membros ficam em rota própria. */
export function TeamForm() {
  const { id } = useParams<{ id: string }>();
  const { teams, loading } = useTeam();
  if (id !== undefined && loading) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  const team = id === undefined ? undefined : teams.find((t) => t.id === id);
  if (id !== undefined && !team) {
    return (
      <FormPage
        crumbs={[{ label: 'Equipes', to: TEAMS_PATH }, { label: 'Equipe' }]}
        title="Equipe"
        onSubmit={() => undefined}
      >
        <p className="alert" role="alert">
          Equipe não encontrada.
        </p>
        <Link to={TEAMS_PATH}>Voltar para a listagem</Link>
      </FormPage>
    );
  }
  return (
    <TeamFormFields
      key={id ?? 'new'}
      teamId={id}
      initial={{
        name: team?.name ?? '',
        dashboardUrl: team?.dashboardUrl ?? '',
        avatar: team?.avatar ?? null,
      }}
    />
  );
}

function TeamFormFields({
  teamId,
  initial,
}: {
  teamId: string | undefined;
  initial: { name: string; dashboardUrl: string; avatar: string | null };
}) {
  const navigate = useNavigate();
  const { create, update, remove } = useTeam();
  const [name, setName] = useState(initial.name);
  const [dashboardUrl, setDashboardUrl] = useState(initial.dashboardUrl);
  const [avatar, setAvatar] = useState<string | null>(initial.avatar);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);

  const trimmed = name.trim();
  const url = dashboardUrl.trim();
  const urlInvalid = url !== '' && !URL_PATTERN.test(url);
  const problem = urlInvalid
    ? URL_MESSAGE
    : nameMissing && !trimmed
      ? 'Informe o nome da equipe.'
      : null;

  const back = () => void navigate(TEAMS_PATH);
  const crumbs = [
    { label: 'Equipes', to: TEAMS_PATH },
    { label: teamId === undefined ? 'Nova equipe' : initial.name },
  ];

  const save = async () => {
    if (!trimmed) {
      setNameMissing(true);
      return;
    }
    if (urlInvalid) return;
    const input: TeamInput = { name: trimmed, dashboardUrl: url || null, avatar };
    setBusy(true);
    try {
      if (teamId === undefined) await create(input);
      else await update(teamId, input);
      back();
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (teamId === undefined) return;
    setBusy(true);
    try {
      await remove(teamId);
      back();
    } catch {
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={teamId === undefined ? 'Nova equipe' : 'Editar equipe'}
        description="Nome, ícone e link do dashboard exibidos para a equipe."
        onSubmit={() => void save()}
      >
        <FormSection title="Dados da equipe">
          <div className="ui-fields">
            <label className="ui-field ui-field--wide">
              Nome da equipe
              <input
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="ui-field ui-field--wide">
              URL do dashboard
              <input
                type="url"
                value={dashboardUrl}
                maxLength={500}
                placeholder="https://"
                onChange={(e) => setDashboardUrl(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="teams-avatars">
            <legend>Ícone</legend>
            <div className="teams-avatar-options">
              <TeamAvatar name={name || 'Nova'} avatar={avatar} size="lg" />
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
          {problem && (
            <p className="alert" role="alert">
              {problem}
            </p>
          )}
        </FormSection>
        {teamId !== undefined && (
          <FormSection
            title="Membros"
            description="Vincule pessoas à equipe e defina papel e rodízio de cada uma."
          >
            <Link to={teamMembersPath(teamId)} className="btn">
              Gerenciar membros
            </Link>
          </FormSection>
        )}
        <FormActions
          busy={busy}
          saveDisabled={urlInvalid}
          onCancel={back}
          onDelete={teamId === undefined ? undefined : () => setConfirming(true)}
        />
      </FormPage>
      {confirming && (
        <ConfirmDialog
          title={`Excluir a equipe “${initial.name}”?`}
          message="A equipe e os vínculos de membros dela deixam de existir. Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
