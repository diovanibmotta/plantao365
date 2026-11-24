import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';
import type { Role } from './AuthContext';
import { useRole } from '../team/TeamContext';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <p className="status" role="status">
        Carregando…
      </p>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

const RANK: Record<Role, number> = { guest: 0, member: 1, manager: 2 };

/** Exige papel mínimo: 'manager' só gestor; 'member' membro ou gestor (não convidado). */
export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();
  const current = useRole();
  if (!user || !current || RANK[current] < RANK[role]) {
    return (
      <section>
        <h1>Acesso restrito</h1>
        <p className="muted">
          {role === 'manager'
            ? 'Esta página é exclusiva para gestores.'
            : 'Esta página é exclusiva para membros convidados. Procure um gestor para receber um convite.'}
        </p>
      </section>
    );
  }
  return <Outlet />;
}
