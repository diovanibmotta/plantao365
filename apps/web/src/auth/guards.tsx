import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';
import type { Role } from './AuthContext';

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

export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();
  if (user?.role !== role) {
    return (
      <section>
        <h1>Acesso restrito</h1>
        <p className="muted">Esta página é exclusiva para gestores.</p>
      </section>
    );
  }
  return <Outlet />;
}
