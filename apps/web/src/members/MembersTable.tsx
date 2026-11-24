import { TABLE_ROLE_OPTIONS } from './types';
import type { Member, MemberRole } from './types';
import './members.css';

interface Props {
  members: Member[];
  busyId: string | null;
  onRole: (member: Member, role: MemberRole) => void;
  onParticipates: (member: Member, value: boolean) => void;
  onToggleActive: (member: Member) => void;
}

export function MembersTable({ members, busyId, onRole, onParticipates, onToggleActive }: Props) {
  return (
    <div className="table-wrap">
      <table className="members-table">
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">E-mail</th>
            <th scope="col">Papel</th>
            <th scope="col">Rodízio</th>
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
                </td>
                <td data-label="E-mail">{m.email}</td>
                <td data-label="Papel">
                  <select
                    aria-label={`Papel de ${m.name}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => onRole(m, e.target.value as MemberRole)}
                  >
                    {TABLE_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Participa do rodízio">
                  <input
                    type="checkbox"
                    aria-label={`Participa do rodízio: ${m.name}`}
                    checked={m.participatesInRotation}
                    disabled={busy}
                    onChange={(e) => onParticipates(m, e.target.checked)}
                  />
                </td>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
