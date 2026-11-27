import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { ApiError } from '../api/client';
import { useManageableTeams } from '../team/TeamContext';
import { toast } from '../toast/toast-store';
import { ConfirmDialog, FormActions, FormPage, FormSection } from '@plantao365/web-sdk';
import { MEMBERS_PATH } from './paths';
import {
  ROLE_OPTIONS,
  blockingShifts,
  copyInviteLink,
  describeError,
  describeShift,
  inviteLink,
  validateNewMember,
} from './types';
import type { FutureShift, Member, NewMemberInput, TeamRole } from './types';
import './members.css';

interface TeamPick {
  role: TeamRole;
  participatesInRotation: boolean;
}

interface TeamMembership extends TeamPick {
  id: string;
}

type Picks = Record<string, TeamPick>;

const memberError = (err: ApiError) => describeError(err, 'Não foi possível concluir a operação.');

const samePick = (a: TeamPick | undefined, b: TeamPick | undefined) =>
  a?.role === b?.role && a?.participatesInRotation === b?.participatesInRotation;

/** Pré-cadastro, edição e desativação de um membro (rota própria, separada da listagem). */
export function MemberForm() {
  const { id: routeId } = useParams<{ id: string }>();
  const isNew = routeId === undefined;
  const navigate = useNavigate();
  const manageable = useManageableTeams();
  const fieldId = useId();
  const [member, setMember] = useState<Member | null>(null);
  const [loaded, setLoaded] = useState(isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [picked, setPicked] = useState<Picks>({});
  const [original, setOriginal] = useState<Picks | null>(isNew ? {} : null);
  const [blocking, setBlocking] = useState<FutureShift[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const teamKey = manageable.map((t) => t.id).join(',');

  useEffect(() => {
    if (isNew) return;
    const controller = new AbortController();
    api
      .get<Member[]>('/api/users', controller.signal)
      .then((list) => {
        const found = list.find((m) => m.id === routeId);
        if (!found) {
          setLoadError('Membro não encontrado.');
          return;
        }
        setMember(found);
        setName(found.name);
        setEmail(found.email);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeError(err, 'Não foi possível carregar o membro.'));
        }
      });
    return () => controller.abort();
  }, [isNew, routeId]);

  useEffect(() => {
    if (isNew || !loaded) return;
    const controller = new AbortController();
    Promise.all(
      teamKey
        .split(',')
        .filter(Boolean)
        .map((teamId) =>
          api
            .get<TeamMembership[]>(`/api/teams/${teamId}/members`, controller.signal)
            .then((list) => [teamId, list.find((m) => m.id === routeId)] as const),
        ),
    )
      .then((entries) => {
        const current: Picks = {};
        for (const [teamId, found] of entries) {
          if (found) {
            current[teamId] = {
              role: found.role,
              participatesInRotation: found.participatesInRotation,
            };
          }
        }
        setOriginal(current);
        setPicked(current);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeError(err, 'Não foi possível carregar as equipes do membro.'));
        }
      });
    return () => controller.abort();
  }, [isNew, loaded, routeId, teamKey]);

  const back = () => void navigate(MEMBERS_PATH);

  const toggleTeam = (teamId: string, on: boolean) =>
    setPicked((prev) => {
      const rest = { ...prev };
      delete rest[teamId];
      return on ? { ...rest, [teamId]: { role: 'member', participatesInRotation: true } } : rest;
    });

  const patchTeam = (teamId: string, patch: Partial<TeamPick>) =>
    setPicked((prev) => ({ ...prev, [teamId]: { ...prev[teamId]!, ...patch } }));

  const dirtyTeams = useMemo(
    () => manageable.filter((t) => !samePick(picked[t.id], original?.[t.id])),
    [manageable, picked, original],
  );

  const create = async () => {
    const teams = manageable
      .filter((t) => picked[t.id])
      .map((t) => ({ teamId: t.id, ...picked[t.id]! }));
    const input: NewMemberInput = {
      name: name.trim(),
      email: email.trim(),
      ...(teams.length ? { teams } : {}),
    };
    const created = await api.post<Member>('/api/users', input, {
      silentSuccess: true,
      errorMessage: memberError,
    });
    toast.success(
      created.teamIds.length > 0
        ? `${created.name} foi pré-cadastrado e vinculado às equipes. Abra o cadastro para copiar o link de acesso.`
        : `${created.name} foi pré-cadastrado. Vincule-o a uma equipe aqui ou em Equipes.`,
    );
  };

  const update = async (current: Member) => {
    if (name.trim() !== current.name) {
      await api.patch<Member>(
        `/api/users/${current.id}`,
        { name: name.trim() },
        { silentSuccess: true, errorMessage: memberError },
      );
    }
    for (const t of dirtyTeams) {
      const next = picked[t.id];
      const opts = { silentSuccess: true, errorMessage: memberError };
      if (next) await api.put(`/api/teams/${t.id}/members/${current.id}`, next, opts);
      else await api.delete(`/api/teams/${t.id}/members/${current.id}`, opts);
    }
    toast.success('Membro salvo.');
  };

  const save = async () => {
    const found = validateNewMember(name, email);
    setErrors(found);
    if (found.name || found.email) return;
    setBusy(true);
    try {
      if (member) await update(member);
      else await create();
      back();
    } catch {
      // erro exibido pelo toast do interceptor
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (!member) return;
    setBusy(true);
    setBlocking([]);
    try {
      const saved = await api.patch<Member>(
        `/api/users/${member.id}`,
        { active },
        {
          successMessage: active ? `${member.name} foi ativado.` : `${member.name} foi desativado.`,
          errorMessage: memberError,
        },
      );
      setMember(saved);
      if (!active) back();
    } catch (err) {
      setBlocking(blockingShifts(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const copyLink = async () => {
    if (await copyInviteLink()) toast.success('Link de acesso copiado.');
    else toast.error('Não foi possível copiar. Copie o link manualmente.');
  };

  const crumbs = [
    { label: 'Membros', to: MEMBERS_PATH },
    { label: isNew ? 'Novo membro' : member ? `Editar ${member.name}` : 'Editar' },
  ];

  if (loadError) {
    return (
      <FormPage crumbs={crumbs} title="Membro" onSubmit={back}>
        <p className="alert" role="alert">
          {loadError}
        </p>
        <div className="ui-actions">
          <button type="button" className="btn" onClick={back}>
            Voltar para a listagem
          </button>
        </div>
      </FormPage>
    );
  }
  if (!loaded || original === null) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  const canDeactivate = member !== null && member.active;

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={isNew ? 'Novo membro' : 'Editar membro'}
        description={
          isNew
            ? 'A pessoa entra com a conta corporativa e o cadastro é associado pelo e-mail.'
            : undefined
        }
        onSubmit={() => void save()}
      >
        <FormSection title="Identificação" description="Nome e e-mail corporativo da pessoa.">
          <div className="ui-fields">
            <label className="ui-field" htmlFor={`${fieldId}-name`}>
              Nome
              <input
                id={`${fieldId}-name`}
                type="text"
                autoComplete="off"
                value={name}
                aria-invalid={errors.name !== undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && (
                <span className="ui-field-error" role="alert">
                  {errors.name}
                </span>
              )}
            </label>
            <label className="ui-field" htmlFor={`${fieldId}-email`}>
              E-mail
              <input
                id={`${fieldId}-email`}
                type="email"
                autoComplete="off"
                value={email}
                readOnly={!isNew}
                aria-invalid={errors.email !== undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
              {errors.email && (
                <span className="ui-field-error" role="alert">
                  {errors.email}
                </span>
              )}
            </label>
          </div>
        </FormSection>

        {manageable.length > 0 && (
          <FormSection
            title="Equipes"
            description={
              isNew
                ? 'Opcional. Vincule agora para que, no primeiro acesso, a pessoa já entre com o papel da equipe.'
                : 'Vínculo, papel e participação no rodízio em cada equipe que você gerencia.'
            }
          >
            {manageable.map((t) => {
              const pick = picked[t.id];
              return (
                <div key={t.id} className="members-team-row">
                  <label className="members-check">
                    <input
                      type="checkbox"
                      aria-label={`Vincular a ${t.name}`}
                      checked={pick !== undefined}
                      onChange={(e) => toggleTeam(t.id, e.target.checked)}
                    />
                    {t.name}
                  </label>
                  {pick && (
                    <>
                      <select
                        aria-label={`Papel em ${t.name}`}
                        value={pick.role}
                        onChange={(e) => {
                          const role = e.target.value as TeamRole;
                          patchTeam(t.id, { role, participatesInRotation: role === 'member' });
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
                          aria-label={`Participa do rodízio em ${t.name}`}
                          checked={pick.participatesInRotation}
                          onChange={(e) =>
                            patchTeam(t.id, { participatesInRotation: e.target.checked })
                          }
                        />
                        Rodízio
                      </label>
                    </>
                  )}
                </div>
              );
            })}
          </FormSection>
        )}

        {member && (
          <FormSection
            title="Acesso e situação"
            description="Membro desativado deixa de entrar em novas escalas e perde o acesso."
          >
            <p>
              Situação: <strong>{member.active ? 'Ativo' : 'Inativo'}</strong>
              {!member.linked && <span className="members-badge">Aguardando primeiro acesso</span>}
            </p>
            {!member.active && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void setActive(true)}
              >
                Ativar membro
              </button>
            )}
            {!member.linked && member.active && (
              <div className="members-invite">
                <p>
                  Envie o link de acesso. A pessoa entra com a conta corporativa e o cadastro é
                  associado pelo e-mail <strong>{member.email}</strong>.
                </p>
                <input type="text" readOnly value={inviteLink()} aria-label="Link de acesso" />
                <div className="members-actions">
                  <button type="button" className="btn" onClick={() => void copyLink()}>
                    Copiar link
                  </button>
                </div>
              </div>
            )}
            {blocking.length > 0 && (
              <div className="alert members-message" role="alert">
                Plantões futuros publicados:
                <ul className="members-shifts">
                  {blocking.map((s) => (
                    <li key={s.shiftId}>{describeShift(s)}</li>
                  ))}
                </ul>
              </div>
            )}
          </FormSection>
        )}

        <FormActions
          busy={busy}
          onCancel={back}
          deleteLabel="Desativar"
          onDelete={canDeactivate ? () => setConfirming(true) : undefined}
        />
      </FormPage>
      {confirming && member && (
        <ConfirmDialog
          title={`Desativar ${member.name}?`}
          message="A pessoa deixa de entrar em novas escalas e perde o acesso. O histórico é mantido e ela pode ser reativada depois."
          confirmLabel="Desativar"
          busy={busy}
          onConfirm={() => void setActive(false)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
