import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiUrl } from '../api/base-url';
import { api, setUnauthorizedHandler, UnauthorizedError } from '../api/client';

export type Role = 'manager' | 'member' | 'guest';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  participatesInRotation: boolean;
  remindersEnabled: boolean;
  isMaster: boolean;
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<AuthUser>('/auth/me', controller.signal)
      .then((me) => {
        setUser(me);
        setStatus('authenticated');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (!(err instanceof UnauthorizedError)) console.error(err);
        setUser(null);
        setStatus('anonymous');
      });
    return () => controller.abort();
  }, []);

  // Sessão expirada em qualquer chamada: vira anônimo e RequireAuth leva ao login.
  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        setUser(null);
        setStatus('anonymous');
      }),
    [],
  );

  const login = useCallback(() => {
    window.location.assign(apiUrl('/auth/login'));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { silentSuccess: true, silentError: true });
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
