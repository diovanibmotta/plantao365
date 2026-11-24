import { Navigate, useSearchParams } from 'react-router';
import { APP_NAME } from '@diovanibmotta/plantao365-shared';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../layout/icons';

const DENIAL_MESSAGES: Record<string, string> = {
  invalid_state: 'A tentativa de login expirou ou é inválida. Tente entrar novamente.',
  idp_error: 'O login não foi concluído. Tente entrar novamente.',
  invalid_token: 'Não foi possível validar sua identidade. Tente entrar novamente.',
  not_registered:
    'Acesso negado. Seu e-mail não está cadastrado no Plantão360. Procure um gestor para ser incluído.',
  inactive: 'Acesso negado. Seu usuário está inativo. Procure um gestor para reativar o acesso.',
  identity_mismatch:
    'Acesso negado. Esta conta corporativa não corresponde ao cadastro. Procure um gestor.',
  denied:
    'Acesso negado. Seu e-mail não está cadastrado ou seu usuário está inativo. Procure um gestor.',
};

const GENERIC_MESSAGE = 'Não foi possível entrar. Tente novamente ou procure um gestor.';

function denialMessage(reason: string | null): string | null {
  if (!reason) return null;
  return Object.hasOwn(DENIAL_MESSAGES, reason) ? DENIAL_MESSAGES[reason]! : GENERIC_MESSAGE;
}

export function LoginPage() {
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  const message = denialMessage(params.get('error'));

  return (
    <main className="login">
      <span className="login-mark">
        <BrandMark />
      </span>
      <h1>{APP_NAME}</h1>
      <p className="muted">Escala de plantão da equipe. Entre com sua conta corporativa.</p>
      {message && (
        <p className="alert" role="alert">
          {message}
        </p>
      )}
      <button type="button" className="btn primary" onClick={login} disabled={status === 'loading'}>
        <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#f25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
          <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
        Entrar com Microsoft
      </button>
    </main>
  );
}
