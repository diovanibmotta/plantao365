import { Navigate, useSearchParams } from 'react-router';
import { APP_NAME } from '@plantao360/shared';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  const denied = params.get('error') === 'denied';

  return (
    <main className="login">
      <h1>{APP_NAME}</h1>
      <p className="muted">Escala de plantão da equipe. Entre com sua conta corporativa.</p>
      {denied && (
        <p className="alert" role="alert">
          Acesso negado. Seu e-mail não está cadastrado ou seu usuário está inativo. Procure um
          gestor.
        </p>
      )}
      <button type="button" className="btn primary" onClick={login} disabled={status === 'loading'}>
        Entrar com Microsoft
      </button>
    </main>
  );
}
