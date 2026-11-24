import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ApiError } from '../api/client';
import { toast } from '../toast/toast-store';
import { MembersTable } from '../members/MembersTable';
import { NewMemberForm } from '../members/NewMemberForm';
import { blockingShifts, describeError, describeShift, sortMembers } from '../members/types';
import type { FutureShift, Member, NewMemberInput } from '../members/types';
import '../members/members.css';

const memberError = (err: ApiError) => describeError(err, 'Não foi possível concluir a operação.');

type Loaded = { members: Member[] } | { error: string } | null;

export function MembersPage() {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [showForm, setShowForm] = useState(false);
  const [blocking, setBlocking] = useState<FutureShift[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Member | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Member[]>('/api/users', controller.signal)
      .then((members) => setLoaded({ members: sortMembers(members) }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ error: describeError(err, 'Não foi possível carregar os membros.') });
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
    try {
      const created = await api.post<Member>('/api/users', input, {
        silentSuccess: true,
        errorMessage: memberError,
      });
      upsert(created);
      setShowForm(false);
      toast.success(`${created.name} foi pré-cadastrado. Vincule-o a uma equipe em Equipes.`);
    } catch {
      // erro exibido pelo toast
    }
  };

  const update = async (member: Member, patch: Partial<Member>, okText: string) => {
    setBusyId(member.id);
    setBlocking([]);
    try {
      const saved = await api.patch<Member>(`/api/users/${member.id}`, patch, {
        successMessage: okText,
        errorMessage: memberError,
      });
      upsert(saved);
    } catch (err) {
      setBlocking(blockingShifts(err));
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
        <h1>Membros</h1>
        {!showForm && (
          <button type="button" className="btn primary" onClick={() => setShowForm(true)}>
            Pré-cadastrar membro
          </button>
        )}
      </div>

      {showForm && <NewMemberForm onSubmit={create} onCancel={() => setShowForm(false)} />}

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

      {blocking.length > 0 && (
        <div className="alert members-message">
          Plantões futuros publicados:
          <ul className="members-shifts">
            {blocking.map((s) => (
              <li key={s.shiftId}>{describeShift(s)}</li>
            ))}
          </ul>
        </div>
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
        <MembersTable members={loaded.members} busyId={busyId} onToggleActive={toggleActive} />
      )}
    </section>
  );
}
