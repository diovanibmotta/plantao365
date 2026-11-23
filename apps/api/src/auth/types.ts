export type Role = 'manager' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  participatesInRotation: boolean;
  remindersEnabled: boolean;
}

export interface AuthVariables {
  user: AuthUser | null;
}

export interface AuthEnv {
  Variables: AuthVariables;
}

export interface OidcOptions {
  mock: boolean;
  issuer?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
}

export interface AuthOptions {
  appBaseUrl: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  oidc: OidcOptions;
}

export interface SessionCookieOptions {
  secure: boolean;
}
