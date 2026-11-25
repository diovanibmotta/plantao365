import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TeamTag } from '../team/PageTitle';
import { useRole } from '../team/TeamContext';
import { UnavailabilityForm } from './UnavailabilityForm';
import { KIND_LABELS, errorMessage, formatDate, formatPeriod } from './types';
import type {
  FormValues,
  MemberOption,
  Unavailability,
  UnavailabilityMutation,
  UnavailabilityWarning,
} from './types';
import './exceptions.css';

interface Props {
  /** 'vacations' = tela de Férias do gestor (individuais e coletivas). */
  mode: 'member' | 'vacations';
  heading: 'h1' | 'h2';
  title: string;
  newLabel: string;
  emptyText: string;
}

type Editing = { mode: 'create' } | { mode: 'edit'; item: Unavailability } | null;
type Loaded = { error: string } | { items: Unavailability[] };

export function UnavailabilityManager({
  mode,
  heading: Heading,
  title,
  newLabel,
  emptyText,
}: Props) {
  const { user } = useAuth();
  const role = useRole();
  const vacations = mode === 'vacations';
  const showMembers = role === 'manager';
  const [loaded, setLoaded] = useState<{ key: number; data: Loaded } | null>(null);
  const [reload, setReload] = useState(0);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<UnavailabilityWarning[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ items: Unavailability[] }>('/api/unavailabilities', controller.signal)
      .then((res) =>
        setLoaded({
          key: reload,
          data: {
            items: res.items.filter((i) =>
              vacations
                ? i.kind === 'vacation' || i.kind === 'collective_vacation'
                : i.kind !== 'collective_vacation',
            ),
          },
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          key: reload,
          data: { error: errorMessage(err, 'Não foi possível carregar as exceções.') },
        });
      });
    return () => controller.abort();
  }, [vacations, reload]);

  useEffect(() => {
    if (!showMembers) return;
    const controller = new AbortController();
    api
      .get<MemberOption[]>('/api/users', controller.signal)
      .then(setMembers)
      .catch(() => undefined);
    return () => controller.abort();
  }, [showMembers]);

  const data = loaded?.key === reload ? loaded.data : null;
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? null;

  function openForm(next: Editing) {
    setEditing(next);
    setRemovingId(null);
  }

  function finish(result?: UnavailabilityMutation) {
    setWarnings(result?.warnings ?? []);
    setEditing(null);
    setReload((n) => n + 1);
  }

  async function save(values: FormValues) {
    if (!editing) return;
    setSaving(true);
    const note = values.note.trim() || null;
    try {
      if (editing.mode === 'create') {
        const body: Record<string, unknown> = {
          kind: vacations ? (values.collective ? 'collective_vacation' : 'vacation') : values.kind,
          startDate: values.startDate,
          endDate: values.endDate,
          note,
        };
        if (vacations && values.collective) {
          if (!values.allTeam) body.userIds = values.userIds;
        } else if (showMembers && values.userId && values.userId !== user?.id) {
          body.userId = values.userId;
        }
        finish(await api.post<UnavailabilityMutation>('/api/unavailabilities', body));
      } else {
        const body: Record<string, unknown> = {
          startDate: values.startDate,
          endDate: values.endDate,
          note,
        };
        if (!vacations) body.kind = values.kind;
        finish(
          await api.patch<UnavailabilityMutation>(`/api/unavailabilities/${editing.item.id}`, body),
        );
      }
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Unavailability) {
    setSaving(true);
    try {
      await api.delete(`/api/unavailabilities/${item.id}`);
      setRemovingId(null);
      finish();
    } catch {
      // erro exibido pelo toast
    } finally {
      setSaving(false);
    }
  }

  const label = (i: Unavailability) =>
    `${KIND_LABELS[i.kind]} ${formatPeriod(i.startDate, i.endDate)}`;

  return (
    <section className="exc-section">
      <div className="exc-header">
        {Heading === 'h1' ? (
          <div className="page-title">
            <Heading>{title}</Heading>
            <TeamTag />
          </div>
        ) : (
          <Heading>{title}</Heading>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={editing !== null}
          onClick={() => openForm({ mode: 'create' })}
        >
          {newLabel}
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="exc-warning" role="status" aria-label="Aviso de conflito">
          <ul>
            {warnings.map((w) =>
              w.type === 'published_shifts_affected' ? (
                <li key={`${w.date}:affected`}>
                  {formatDate(w.date)}:{' '}
                  {w.count === 1 ? '1 plantão publicado' : `${w.count} plantões publicados`} neste
                  dia. Ajuste os plantões ou recalcule a escala.
                </li>
              ) : (
                <li key={`${w.date}:${w.userId}`}>
                  Conflito com plantão publicado em {formatDate(w.date)}
                  {nameOf(w.userId) ? ` (${nameOf(w.userId)})` : ''}.{' '}
                  {role === 'manager'
                    ? 'Ajuste a escala, se necessário.'
                    : 'O gestor foi avisado por e-mail.'}
                </li>
              ),
            )}
          </ul>
          <button type="button" className="btn" onClick={() => setWarnings([])}>
            Dispensar
          </button>
        </div>
      )}

      {editing && (
        <UnavailabilityForm
          key={editing.mode === 'edit' ? editing.item.id : 'new'}
          title={editing.mode === 'create' ? newLabel : 'Editar'}
          withKind={!vacations}
          withScope={vacations && editing.mode === 'create'}
          members={showMembers && editing.mode === 'create' ? members : null}
          selfId={user?.id ?? ''}
          initial={
            editing.mode === 'edit'
              ? {
                  kind: editing.item.kind,
                  startDate: editing.item.startDate,
                  endDate: editing.item.endDate,
                  note: editing.item.note ?? '',
                  userId: editing.item.userId ?? '',
                  collective: editing.item.kind === 'collective_vacation',
                  allTeam: true,
                  userIds: [],
                }
              : null
          }
          saving={saving}
          onSubmit={(v) => void save(v)}
          onCancel={() => openForm(null)}
        />
      )}

      {data === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {data !== null && 'error' in data && (
        <p className="alert" role="alert">
          {data.error}
        </p>
      )}
      {data !== null && 'items' in data && data.items.length === 0 && (
        <p className="status muted">{emptyText}</p>
      )}
      {data !== null && 'items' in data && data.items.length > 0 && (
        <ul className="exc-list" aria-label={title}>
          {[...data.items]
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map((i) => (
              <li key={i.id} className="exc-item">
                <div className="exc-info">
                  <span>
                    {KIND_LABELS[i.kind]}: {formatPeriod(i.startDate, i.endDate)}
                  </span>
                  {showMembers && i.userId && (
                    <span className="exc-meta">{nameOf(i.userId) ?? 'Membro'}</span>
                  )}
                  {vacations && !i.userId && <span className="exc-meta">Todo o time</span>}
                  {i.note && <span className="exc-meta">{i.note}</span>}
                </div>
                {removingId === i.id ? (
                  <div className="exc-actions" role="group" aria-label={`Remover ${label(i)}`}>
                    <span>Remover?</span>
                    <button
                      type="button"
                      className="btn exc-danger"
                      disabled={saving}
                      onClick={() => void remove(i)}
                    >
                      Confirmar remoção
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => setRemovingId(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="exc-actions">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Editar ${label(i)}`}
                      onClick={() => openForm({ mode: 'edit', item: i })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Remover ${label(i)}`}
                      onClick={() => {
                        setEditing(null);
                        setRemovingId(i.id);
                      }}
                    >
                      Remover
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
