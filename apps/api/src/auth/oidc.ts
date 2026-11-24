import { createHash } from 'node:crypto';
import * as client from 'openid-client';
import type { OidcOptions } from './types.js';

export interface UserPhoto {
  data: Buffer;
  type: string;
}

export interface OidcIdentity {
  email: string;
  name: string | undefined;
  oid: string;
  /** Foto do diretório; null = usuário sem foto; ausente = não consultada ou falhou (manter). */
  photo?: UserPhoto | null;
}

const GRAPH_PHOTO_URL = 'https://graph.microsoft.com/v1.0/me/photos/96x96/$value';
const MAX_PHOTO_BYTES = 512 * 1024;

/**
 * Baixa a foto do usuário no Microsoft Graph. Nunca lança: falha de rede ou resposta inesperada
 * devolve undefined para não bloquear o login.
 */
export async function fetchGraphPhoto(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserPhoto | null | undefined> {
  try {
    const res = await fetchImpl(GRAPH_PHOTO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!res.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type)) return undefined;
    const data = Buffer.from(await res.arrayBuffer());
    return data.byteLength > 0 && data.byteLength <= MAX_PHOTO_BYTES ? { data, type } : undefined;
  } catch {
    return undefined;
  }
}

export interface OidcExpected {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcProvider {
  readonly mock: boolean;
  authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): Promise<URL>;
  /** Valida a resposta do IdP e devolve a identidade; lança erro se o retorno for inválido. */
  exchange(callbackParams: URLSearchParams, expected: OidcExpected): Promise<OidcIdentity>;
}

export class OidcError extends Error {}

export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

type Claims = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

/** Mapeia as claims do id_token do Entra ID para a identidade usada no login. */
export function claimsToIdentity(claims: Claims): OidcIdentity {
  const email = (
    str(claims['email']) ??
    str(claims['preferred_username']) ??
    str(claims['upn'])
  )?.toLowerCase();
  const oid = str(claims['oid']) ?? str(claims['sub']);
  if (!email?.includes('@')) throw new OidcError('Token sem e-mail válido.');
  if (!oid) throw new OidcError('Token sem identificador do usuário.');
  return { email, name: str(claims['name']), oid };
}

export function createEntraProvider(opts: OidcOptions, redirectUri: string): OidcProvider {
  const { issuer, clientId, clientSecret } = opts;
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('OIDC_ISSUER, OIDC_CLIENT_ID e OIDC_CLIENT_SECRET são obrigatórios.');
  }
  let config: Promise<client.Configuration> | undefined;
  const getConfig = () => {
    config ??= client.discovery(new URL(issuer), clientId, clientSecret).catch((err: unknown) => {
      config = undefined;
      throw err;
    });
    return config;
  };

  return {
    mock: false,
    async authorizationUrl({ state, nonce, codeChallenge }) {
      return client.buildAuthorizationUrl(await getConfig(), {
        redirect_uri: redirectUri,
        scope: 'openid profile email User.Read',
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });
    },
    async exchange(params, { state, nonce, codeVerifier }) {
      const url = new URL(redirectUri);
      url.search = params.toString();
      try {
        const tokens = await client.authorizationCodeGrant(await getConfig(), url, {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims) throw new OidcError('Resposta sem id_token.');
        const identity = claimsToIdentity(claims as Claims);
        const photo = await fetchGraphPhoto(tokens.access_token);
        return photo === undefined ? identity : { ...identity, photo };
      } catch (err) {
        if (err instanceof OidcError) throw err;
        throw new OidcError('Falha na validação do login.', { cause: err });
      }
    },
  };
}

/** IdP falso para desenvolvimento: o e-mail vem do formulário de /auth/login. */
export function createMockProvider(): OidcProvider {
  return {
    mock: true,
    authorizationUrl() {
      return Promise.reject(new Error('IdP mock não usa redirecionamento.'));
    },
    exchange(params, { state }) {
      if (params.get('state') !== state) throw new OidcError('Estado inválido.');
      const email = params.get('email')?.trim().toLowerCase();
      if (!email?.includes('@')) throw new OidcError('Informe um e-mail válido.');
      return Promise.resolve({ email, name: undefined, oid: `mock:${email}` });
    },
  };
}
