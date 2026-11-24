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
    OIDC_MOCK: bool,
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
    /** Força o atributo Secure do cookie de sessão; sem valor, vale true só em produção. */
    COOKIE_SECURE: optional(strictBool),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(28800),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.OIDC_MOCK) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_MOCK'],
        message: 'não pode ser true em produção',
      });
    }
    if (!env.OIDC_MOCK && env.NODE_ENV === 'production') {
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
    if (env.NODE_ENV === 'production' && env.MANAGER_EMAILS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['MANAGER_EMAILS'],
        message: 'informe ao menos um gestor em produção',
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
