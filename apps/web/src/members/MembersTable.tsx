import type { Member } from './types';
import './members.css';

interface Props {
  members: Member[];
  busyId: string | null;
  onToggleActive: (member: Member) => void;
  onShowLink: (member: Member) => void;
}

export function MembersTable({ members, busyId, onToggleActive, onShowLink }: Props) {
  return (
    <div className="table-wrap">
      <table className="members-table">
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">E-mail</th>
            <th scope="col">Status</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const busy = busyId === m.id;
            return (
              <tr key={m.id} className={m.active ? undefined : 'members-inactive'}>
                <td data-label="Nome">
                  {m.name}
                  {!m.linked && <span className="members-badge">Aguardando primeiro acesso</span>}
                  {m.teamIds.length === 0 && <span className="members-badge">Sem equipe</span>}
                </td>
                <td data-label="E-mail">{m.email}</td>
                <td data-label="Status">{m.active ? 'Ativo' : 'Inativo'}</td>
                <td data-label="Ações">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    aria-label={`${m.active ? 'Desativar' : 'Ativar'} ${m.name}`}
                    onClick={() => onToggleActive(m)}
                  >
                    {m.active ? 'Desativar' : 'Ativar'}
                  </button>
                  {!m.linked && m.active && (
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Link de acesso de ${m.name}`}
                      onClick={() => onShowLink(m)}
                    >
                      Link de acesso
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
