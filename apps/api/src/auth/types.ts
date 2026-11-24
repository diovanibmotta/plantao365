export type Role = 'manager' | 'member' | 'guest';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  participatesInRotation: boolean;
  remindersEnabled: boolean;
  /** Usuário da master key (acesso de bootstrap definido por variáveis de ambiente). */
  isMaster: boolean;
}

export interface AuthVariables {
  user: AuthUser | null;
  /** Equipe ativa da requisição (header X-Team-Id); null quando o usuário não tem equipe. */
  teamId: string | null;
}

export interface AuthEnv {
  Variables: AuthVariables;
}

export interface OidcOptions {
  issuer?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
}

/** Credenciais da master key; ausente = login master desabilitado. */
export interface MasterKeyOptions {
  username: string;
  password: string;
}

export interface AuthOptions {
  appBaseUrl: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  oidc: OidcOptions;
  master?: MasterKeyOptions | undefined;
}

export interface SessionCookieOptions {
  secure: boolean;
}
