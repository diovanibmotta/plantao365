import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

const emailList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()));

const originList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(
      z
        .string()
        .refine(
          (o) => URL.canParse(o) && /^https?:$/.test(new URL(o).protocol),
          'use uma URL http:// ou https://',
        )
        .transform((o) => new URL(o).origin),
    ),
  );

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const strictBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_BASE_URL: z.url().default('http://localhost:5173'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'deve começar com postgres:// ou postgresql://'),
    /** E-mails dos gestores iniciais, separados por vírgula (Requisito 1.6). */
    MANAGER_EMAILS: emailList,
    OIDC_ISSUER: optional(z.url()),
    OIDC_CLIENT_ID: optional(z.string()),
    OIDC_CLIENT_SECRET: optional(z.string()),
    OIDC_REDIRECT_URI: optional(z.url()),
    SMTP_HOST: optional(z.string()),
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    SMTP_FROM: optional(z.email()),
    SMTP_SECURE: optional(bool),
    /** Documentação de implantação (wiki), linkada nos avisos de recurso não configurado. */
    DOCS_URL: z.url().default('https://github.com/diovanibmotta/plantao365/wiki'),
    /** Pasta do build do front (imagem única): a API serve a SPA no mesmo domínio. */
    WEB_DIST_DIR: optional(z.string()),
    /**
     * Origens do front servidas em outro domínio que a API (ex.: CDN em plantao.exemplo.com e API
     * em api.exemplo.com), separadas por vírgula. Habilita CORS com credenciais. Vazio: mesmo domínio.
     */
    CORS_ALLOWED_ORIGINS: originList,
    /** Força o atributo Secure do cookie de sessão; sem valor, vale true só em produção. */
    COOKIE_SECURE: optional(strictBool),
    /** Aplica as migrações pendentes na subida da API (com lock entre réplicas); false desliga. */
    AUTO_MIGRATE: z.preprocess(emptyToUndefined, strictBool.default(true)),
    /** Master key: usuário/senha de bootstrap para o primeiro acesso (ambos ou nenhum). */
    MASTER_USERNAME: optional(z.string().min(3).max(64)),
    MASTER_PASSWORD: optional(z.string().min(12, 'use ao menos 12 caracteres').max(256)),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(28800),
    /**
     * Chaves públicas Ed25519 (base64 DER/SPKI, separadas por vírgula) confiáveis além da loja
     * oficial e das cadastradas pela tela. Opcional.
     */
    PLUGIN_PUBLIC_KEYS: optional(z.string()),
    /** Cache local onde os pacotes de plugin são extraídos; padrão: diretório temporário do SO. */
    PLUGINS_DIR: optional(z.string()),
    /** Índice da loja de plugins; sem valor usa a loja oficial, `off` desliga. */
    PLUGIN_CATALOG_URL: optional(z.union([z.literal('off'), z.url({ protocol: /^https?$/ })])),
    /** Token da CLI (`plantao-plugin install --token`); vazio: só gestor logado instala. */
    PLUGIN_INSTALL_TOKEN: optional(z.string().min(32, 'use ao menos 32 caracteres')),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const k of [
        'OIDC_ISSUER',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
        'OIDC_REDIRECT_URI',
      ] as const) {
        if (!env[k])
          ctx.addIssue({ code: 'custom', path: [k], message: 'obrigatória em produção' });
      }
    }
    if (env.SMTP_HOST && !env.SMTP_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_FROM'],
        message: 'obrigatória quando SMTP_HOST está definido',
      });
    }
    if (Boolean(env.MASTER_USERNAME) !== Boolean(env.MASTER_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.MASTER_USERNAME ? 'MASTER_PASSWORD' : 'MASTER_USERNAME'],
        message: 'MASTER_USERNAME e MASTER_PASSWORD devem ser definidos juntos',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.MANAGER_EMAILS.length === 0 &&
      !(env.MASTER_USERNAME && env.MASTER_PASSWORD)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['MANAGER_EMAILS'],
        message:
          'informe ao menos um gestor ou a master key (MASTER_USERNAME/MASTER_PASSWORD) em produção',
      });
    }
  });

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração inválida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Valida as variáveis de ambiente; nunca inclui valores nas mensagens de erro. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    );
  }
  return result.data;
}
