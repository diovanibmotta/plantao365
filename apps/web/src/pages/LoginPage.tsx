import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { APP_NAME } from '@plantao365/shared';
import { api, ApiError, UnauthorizedError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../layout/icons';

const DENIAL_MESSAGES: Record<string, string> = {
  invalid_state: 'A tentativa de login expirou ou é inválida. Tente entrar novamente.',
  idp_error: 'O login não foi concluído. Tente entrar novamente.',
  invalid_token: 'Não foi possível validar sua identidade. Tente entrar novamente.',
  not_registered:
    'Acesso negado. Seu e-mail não está cadastrado no Plantão365. Procure um gestor para ser incluído.',
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

function MasterLogin({ open }: { open: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(
        '/auth/master-login',
        { username, password },
        { silentSuccess: true, silentError: true },
      );
      window.location.assign('/');
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? 'Usuário ou senha inválidos.'
          : err instanceof ApiError
            ? err.message
            : 'Não foi possível entrar. Tente novamente.',
      );
      setBusy(false);
    }
  };

  return (
    <details className="master-login" open={open || undefined}>
      <summary>Acesso master</summary>
      <form onSubmit={(e) => void submit(e)} aria-label="Acesso master">
        <label>
          Usuário
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar como master'}
        </button>
      </form>
    </details>
  );
}

export function LoginPage() {
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  const [config, setConfig] = useState<{ masterLogin: boolean; sso: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ masterLogin: boolean; sso: boolean }>('/auth/config', controller.signal)
      .then(setConfig)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setConfig({ masterLogin: true, sso: true });
      });
    return () => controller.abort();
  }, []);
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
      {config && !config.sso && (
        <p className="muted">
          Login corporativo (SSO) não configurado neste ambiente.
          {config.masterLogin ? ' Use o acesso master.' : ' Procure o administrador.'}
        </p>
      )}
      {(!config || config.sso) && (
        <button
          type="button"
          className="btn primary"
          onClick={login}
          disabled={status === 'loading'}
        >
          <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Entrar com Microsoft
        </button>
      )}
      {config?.masterLogin && <MasterLogin open={!config.sso} />}
    </main>
  );
}
