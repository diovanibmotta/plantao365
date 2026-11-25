import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useRole } from '../team/TeamContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FormActions, FormPage, FormSection } from '../ui/FormPage';
import type { Crumb } from '../ui/FormPage';
import { PROFILE_EXCEPTIONS_PATH, SCOPES, VACATIONS_PATH } from './paths';
import type { UnavailabilityMode } from './paths';
import {
  KIND_LABELS,
  KIND_OPTIONS,
  LEGACY_VACATION_OPTION,
  errorMessage,
  formatPeriod,
  validatePeriod,
} from './types';
import type { ExceptionKind, MemberOption, Unavailability, UnavailabilityMutation } from './types';
import './exceptions.css';

const TEXTS = {
  vacations: {
    list: 'Férias',
    newTitle: 'Novas férias',
    editTitle: 'Editar férias',
    created: 'Férias cadastradas.',
    updated: 'Férias atualizadas.',
    deleted: 'Férias excluídas.',
    notFound: 'Registro de férias não encontrado.',
    deleteMessage:
      'Os dias deixam de contar como férias e voltam a ficar disponíveis na geração de escalas. Plantões já publicados não mudam automaticamente: revise a escala, se necessário.',
  },
  member: {
    list: 'Exceções',
    newTitle: 'Nova exceção',
    editTitle: 'Editar exceção',
    created: 'Exceção cadastrada.',
    updated: 'Exceção atualizada.',
    deleted: 'Exceção excluída.',
    notFound: 'Exceção não encontrada.',
    deleteMessage:
      'Os dias voltam a ficar disponíveis na geração de escalas. Plantões já publicados não mudam automaticamente.',
  },
} as const;

interface Values {
  kind: ExceptionKind;
  startDate: string;
  endDate: string;
  note: string;
  userId: string;
  /** Só em Férias, ao criar: false = individual, true = coletiva. */
  collective: boolean;
  /** Coletiva: true = todo o time; false = só os `userIds`. */
  allTeam: boolean;
  userIds: string[];
}

/** Cadastro, edição e exclusão de uma ausência (rota própria, separada da listagem). */
export function UnavailabilityForm({ mode }: { mode: UnavailabilityMode }) {
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  const { user } = useAuth();
  const role = useRole();
  const vacations = mode === 'vacations';
  const showMembers = role === 'manager' && vacations;
  const texts = TEXTS[mode];
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [item, setItem] = useState<Unavailability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!showMembers) return;
    const controller = new AbortController();
    api
      .get<MemberOption[]>('/api/users', controller.signal)
      .then(setMembers)
      .catch(() => undefined);
    return () => controller.abort();
  }, [showMembers]);

  useEffect(() => {
    if (isNew) return;
    const controller = new AbortController();
    api
      .get<{ items: Unavailability[] }>('/api/unavailabilities', controller.signal)
      .then((res) => {
        const found = res.items.find(
          (i) =>
            i.id === id &&
            (vacations
              ? i.kind === 'vacation' || i.kind === 'collective_vacation'
              : i.kind !== 'collective_vacation' && i.userId === user?.id),
        );
        if (found) setItem(found);
        else setLoadError(texts.notFound);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(errorMessage(err, 'Não foi possível carregar o registro.'));
        }
      });
    return () => controller.abort();
  }, [isNew, id, vacations, user?.id, texts.notFound]);

  const listPath = SCOPES[mode].listPath;
  const root: Crumb[] = vacations
    ? [{ label: texts.list, to: VACATIONS_PATH }]
    : [
        { label: 'Perfil', to: '/profile' },
        { label: texts.list, to: PROFILE_EXCEPTIONS_PATH },
      ];

  if (loadError) {
    return (
      <FormPage
        crumbs={[...root, { label: 'Editar' }]}
        title={texts.editTitle}
        onSubmit={() => void navigate(listPath)}
      >
        <p className="alert" role="alert">
          {loadError}
        </p>
        <div className="ui-actions">
          <button type="button" className="btn" onClick={() => void navigate(listPath)}>
            Voltar para a listagem
          </button>
        </div>
      </FormPage>
    );
  }
  if (!isNew && !item) {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }

  return (
    <UnavailabilityFormBody
      mode={mode}
      item={item}
      members={members}
      showMembers={showMembers}
      selfId={user?.id ?? ''}
      root={root}
    />
  );
}

function UnavailabilityFormBody({
  mode,
  item,
  members,
  showMembers,
  selfId,
  root,
}: {
  mode: UnavailabilityMode;
  item: Unavailability | null;
  members: MemberOption[];
  showMembers: boolean;
  selfId: string;
  root: Crumb[];
}) {
  const navigate = useNavigate();
  const vacations = mode === 'vacations';
  const texts = TEXTS[mode];
  const listPath = SCOPES[mode].listPath;
  const isNew = item === null;

  const [values, setValues] = useState<Values>({
    kind: item?.kind ?? 'time_off',
    startDate: item?.startDate ?? '',
    endDate: item?.endDate ?? '',
    note: item?.note ?? '',
    userId: item?.userId ?? selfId,
    collective: false,
    allTeam: true,
    userIds: [],
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const patch = (p: Partial<Values>) => {
    setProblem(null);
    setValues((v) => ({ ...v, ...p }));
  };

  const activeMembers = members.filter((m) => m.active);
  const picking = vacations && isNew && values.collective && !values.allTeam;
  const kindOptions =
    item?.kind === 'vacation' ? [LEGACY_VACATION_OPTION, ...KIND_OPTIONS] : KIND_OPTIONS;
  const nameOf = (uid: string | null) => members.find((m) => m.id === uid)?.name ?? null;

  const done = (result?: UnavailabilityMutation) =>
    void navigate(listPath, { state: { warnings: result?.warnings ?? [] } });

  const save = async () => {
    const issue =
      validatePeriod(values.startDate, values.endDate) ??
      (picking && values.userIds.length === 0 ? 'Selecione ao menos um membro.' : null);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    const note = values.note.trim() || null;
    try {
      if (isNew) {
        const body: Record<string, unknown> = {
          kind: vacations ? (values.collective ? 'collective_vacation' : 'vacation') : values.kind,
          startDate: values.startDate,
          endDate: values.endDate,
          note,
        };
        if (vacations && values.collective) {
          if (!values.allTeam) body.userIds = values.userIds;
        } else if (showMembers && values.userId && values.userId !== selfId) {
          body.userId = values.userId;
        }
        done(
          await api.post<UnavailabilityMutation>('/api/unavailabilities', body, {
            successMessage: texts.created,
          }),
        );
      } else {
        const body: Record<string, unknown> = {
          startDate: values.startDate,
          endDate: values.endDate,
          note,
        };
        if (!vacations) body.kind = values.kind;
        done(
          await api.patch<UnavailabilityMutation>(`/api/unavailabilities/${item.id}`, body, {
            successMessage: texts.updated,
          }),
        );
      }
    } catch {
      // O interceptor já exibe o toast de erro.
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.delete(`/api/unavailabilities/${item.id}`, { successMessage: texts.deleted });
      done();
    } catch {
      // O interceptor já exibe o toast de erro.
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (uid: string) =>
    patch({
      userIds: values.userIds.includes(uid)
        ? values.userIds.filter((x) => x !== uid)
        : [...values.userIds, uid],
    });

  const crumbs: Crumb[] = [...root, { label: isNew ? texts.newTitle : 'Editar' }];

  return (
    <>
      <FormPage
        crumbs={crumbs}
        title={isNew ? texts.newTitle : texts.editTitle}
        description={
          vacations
            ? 'Nos dias informados o membro não é escalado.'
            : 'Nos dias informados você não é escalado.'
        }
        onSubmit={() => void save()}
      >
        {vacations && (
          <FormSection
            title="Quem"
            description={isNew ? 'Férias individuais ou coletivas.' : undefined}
          >
            {isNew && showMembers ? (
              <div className="ui-fields">
                <label className="ui-field">
                  Tipo de férias
                  <select
                    value={values.collective ? 'collective' : 'individual'}
                    onChange={(e) => patch({ collective: e.target.value === 'collective' })}
                  >
                    <option value="individual">Individual</option>
                    <option value="collective">Coletiva</option>
                  </select>
                </label>
                {!values.collective && (
                  <label className="ui-field">
                    Membro
                    <select
                      value={values.userId}
                      onChange={(e) => patch({ userId: e.target.value })}
                    >
                      {activeMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ) : (
              !isNew && (
                <p>
                  {KIND_LABELS[item.kind]}:{' '}
                  {item.userId ? (nameOf(item.userId) ?? 'Membro') : 'Todo o time'}
                </p>
              )
            )}
            {isNew && showMembers && values.collective && (
              <fieldset className="exc-fieldset">
                <legend>Quem entra de férias</legend>
                <label className="exc-check">
                  <input
                    type="radio"
                    name="who"
                    checked={values.allTeam}
                    onChange={() => patch({ allTeam: true })}
                  />
                  Todo o time
                </label>
                <label className="exc-check">
                  <input
                    type="radio"
                    name="who"
                    checked={!values.allTeam}
                    onChange={() => patch({ allTeam: false })}
                  />
                  Membros específicos
                </label>
                {!values.allTeam && (
                  <ul aria-label="Membros em férias">
                    {activeMembers.map((m) => (
                      <li key={m.id}>
                        <label className="exc-check">
                          <input
                            type="checkbox"
                            checked={values.userIds.includes(m.id)}
                            onChange={() => toggle(m.id)}
                          />
                          {m.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            )}
          </FormSection>
        )}

        <FormSection title="Período" description="Primeiro e último dia da ausência.">
          <div className="ui-fields">
            {!vacations && (
              <label className="ui-field">
                Tipo
                <select
                  value={values.kind}
                  onChange={(e) => patch({ kind: e.target.value as ExceptionKind })}
                >
                  {kindOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="ui-field">
              Data inicial
              <input
                type="date"
                value={values.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
            </label>
            <label className="ui-field">
              Data final
              <input
                type="date"
                value={values.endDate}
                onChange={(e) => patch({ endDate: e.target.value })}
              />
            </label>
          </div>
        </FormSection>

        <FormSection title="Observação" description="Opcional.">
          <label className="ui-field ui-field--wide">
            Observação (opcional)
            <textarea
              rows={2}
              maxLength={500}
              value={values.note}
              onChange={(e) => patch({ note: e.target.value })}
            />
          </label>
        </FormSection>

        {problem && (
          <p className="alert" role="alert">
            {problem}
          </p>
        )}
        <FormActions
          busy={busy}
          onCancel={() => void navigate(listPath)}
          onDelete={isNew ? undefined : () => setConfirming(true)}
        />
      </FormPage>
      {confirming && item && (
        <ConfirmDialog
          title={`Excluir ${KIND_LABELS[item.kind].toLowerCase()} de ${formatPeriod(item.startDate, item.endDate)}?`}
          message={texts.deleteMessage}
          confirmLabel="Excluir"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
