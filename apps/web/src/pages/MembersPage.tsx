import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { MembersTable } from '../members/MembersTable';
import { NewMemberForm } from '../members/NewMemberForm';
import { blockingShifts, describeError, describeShift, sortMembers } from '../members/types';
import type { FutureShift, Member, MemberRole, NewMemberInput } from '../members/types';
import '../members/members.css';

type Loaded = { members: Member[] } | { error: string } | null;

export function MembersPage() {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
    shifts?: FutureShift[];
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Member | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Member[]>('/api/users', controller.signal)
      .then((members) => setLoaded({ members: sortMembers(members) }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ error: describeError(err, 'Não foi possível carregar a equipe.') });
      });
    return () => controller.abort();
  }, []);

  const upsert = (member: Member) =>
    setLoaded((prev) => {
      if (prev === null || !('members' in prev)) return prev;
      const rest = prev.members.filter((m) => m.id !== member.id);
      return { members: sortMembers([...rest, member]) };
    });

  const create = async (input: NewMemberInput) => {
    setFormError(null);
    try {
      const created = await api.post<Member>('/api/users', input);
      upsert(created);
      setShowForm(false);
      setMessage({ kind: 'ok', text: `${created.name} foi pré-cadastrado.` });
    } catch (err) {
      setFormError(describeError(err, 'Não foi possível cadastrar o membro.'));
    }
  };

  const update = async (member: Member, patch: Partial<Member>, okText: string) => {
    setBusyId(member.id);
    setMessage(null);
    try {
      const saved = await api.patch<Member>(`/api/users/${member.id}`, patch);
      upsert(saved);
      setMessage({ kind: 'ok', text: okText });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: describeError(err, 'Não foi possível salvar a alteração.'),
        shifts: blockingShifts(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = (m: Member) => {
    if (m.active) {
      setConfirming(m);
      return;
    }
    void update(m, { active: true }, `${m.name} foi ativado.`);
  };

  const confirmDeactivate = async () => {
    if (!confirming) return;
    const target = confirming;
    setConfirming(null);
    await update(target, { active: false }, `${target.name} foi desativado.`);
  };

  return (
    <section>
      <div className="members-head">
        <h1>Equipe</h1>
        {!showForm && (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setFormError(null);
              setShowForm(true);
            }}
          >
            Pré-cadastrar membro
          </button>
        )}
      </div>

      {showForm && (
        <NewMemberForm
          onSubmit={create}
          onCancel={() => setShowForm(false)}
          serverError={formError}
        />
      )}

      {confirming && (
        <div className="members-confirm" role="alertdialog" aria-label="Confirmar desativação">
          <p>
            Desativar <strong>{confirming.name}</strong>? A pessoa deixa de entrar em novas escalas
            e perde o acesso.
          </p>
          <div className="members-actions">
            <button type="button" className="btn primary" onClick={() => void confirmDeactivate()}>
              Confirmar desativação
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {message?.kind === 'ok' && (
        <p className="members-message" role="status">
          {message.text}
        </p>
      )}
      {message?.kind === 'error' && (
        <p className="alert members-message" role="alert">
          {message.text}
          {message.shifts && message.shifts.length > 0 && (
            <>
              {' '}
              Plantões futuros publicados:
              <ul className="members-shifts">
                {message.shifts.map((s) => (
                  <li key={s.shiftId}>{describeShift(s)}</li>
                ))}
              </ul>
            </>
          )}
        </p>
      )}

      {loaded === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {loaded !== null && 'error' in loaded && (
        <p className="alert" role="alert">
          {loaded.error}
        </p>
      )}
      {loaded !== null && 'members' in loaded && loaded.members.length === 0 && (
        <p className="status muted">Nenhum membro cadastrado.</p>
      )}
      {loaded !== null && 'members' in loaded && loaded.members.length > 0 && (
        <MembersTable
          members={loaded.members}
          busyId={busyId}
          onRole={(m: Member, role: MemberRole) =>
            void update(m, { role }, `Papel de ${m.name} atualizado.`)
          }
          onParticipates={(m, value) =>
            void update(m, { participatesInRotation: value }, `Rodízio de ${m.name} atualizado.`)
          }
          onToggleActive={toggleActive}
        />
      )}
    </section>
  );
}
