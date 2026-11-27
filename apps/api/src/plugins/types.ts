import { z } from 'zod';

/** Versão do contrato do kernel (ver packages/plugin-sdk). Mude o major ao quebrar o contrato. */
export const KERNEL_API_VERSION = '1.1.0';

export const PLUGIN_STATUSES = ['installed', 'enabled', 'disabled', 'failed'] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Caminho relativo dentro do pacote: sem `..`, `.`, barra inicial nem caracteres especiais. */
export const packagePath = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/)
  .refine((p) => p.split('/').every((s) => s !== '.' && s !== '..'), 'caminho inválido');

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  name: z.string().trim().min(1).max(100),
  version: z.string().regex(SEMVER),
  description: z.string().trim().max(500).optional(),
  /** Faixa do contrato do kernel, no formato `^MAJOR.MINOR.PATCH`. */
  kernelApi: z.string().regex(/^\^\d+\.\d+\.\d+$/),
  server: z.object({ entry: packagePath }).optional(),
  /**
   * Rotas do plugin (relativas a /api/extensions/<id>) que o convidado pode ler (GET/HEAD).
   * Segmentos `:param` casam qualquer valor; sem isso, convidado recebe 403.
   */
  guestReadPaths: z
    .array(z.string().regex(/^(\/(:?[A-Za-z0-9_-]+))+$|^\/$/))
    .max(20)
    .optional(),
  web: z.object({ entry: packagePath }).optional(),
  /** Gravado pela CLI quando o CSS do pacote passou no lint de estilo; obrigatório com `web`. */
  styleCheck: z.literal('passed').optional(),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string | null;
  status: PluginStatus;
  error: string | null;
  settings: Record<string, unknown>;
  /** Carregado nesta instância da API. */
  active: boolean;
  installedAt: string;
  updatedAt: string;
}

export type PluginErrorCode =
  | 'plugins_disabled'
  | 'invalid_package'
  | 'invalid_signature'
  | 'incompatible_kernel'
  | 'version_conflict'
  | 'plugin_not_found'
  | 'activation_failed';

const STATUS: Record<PluginErrorCode, 400 | 404 | 409 | 422 | 503> = {
  plugins_disabled: 503,
  invalid_package: 400,
  invalid_signature: 422,
  incompatible_kernel: 422,
  version_conflict: 409,
  plugin_not_found: 404,
  activation_failed: 422,
};

/** Erro de regra do kernel, devolvido pela API como `{ error, message }`. */
export class PluginError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginError';
  }

  get status() {
    return STATUS[this.code];
  }
}
