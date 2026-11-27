import { z } from 'zod';
import { MAX_ARCHIVE_BYTES, sha256 } from './package.js';
import { packagePath, PluginError } from './types.js';

/** Índice da loja oficial (CDN na frente de um bucket privado). */
export const DEFAULT_CATALOG_URL = '';

/** Chaves públicas Ed25519 (base64 DER/SPKI) da loja oficial: confiáveis sem configuração. */
export const OFFICIAL_STORE_KEYS: readonly string[] = [];

const MAX_CATALOG_BYTES = 1024 * 1024;

const versionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  kernelApi: z.string().regex(/^\^\d+\.\d+\.\d+$/),
  /** Relativa ao índice ou absoluta na mesma origem dele. */
  url: z.string().min(1).max(500),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.base64().min(1).max(200),
});

const catalogSchema = z.object({
  format: z.literal(1),
  plugins: z
    .array(
      z.object({
        id: packagePath,
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        repository: z.url({ protocol: /^https$/ }).optional(),
        versions: z.array(versionSchema).min(1).max(100),
      }),
    )
    .max(500),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogPlugin = Catalog['plugins'][number];

export interface PluginStoreDeps {
  catalogUrl: string;
  fetch?: typeof fetch;
  cacheMs?: number;
  timeoutMs?: number;
}

export interface PluginStore {
  catalog(): Promise<Catalog>;
  /** Baixa o pacote de uma versão do catálogo, conferindo origem, tamanho e sha256. */
  download(id: string, version: string): Promise<{ archive: Buffer; signature: Buffer }>;
}

const unavailable = (reason: string) =>
  new PluginError('store_unavailable', `Não foi possível acessar a loja de plugins: ${reason}.`);

export function createPluginStore({
  catalogUrl,
  fetch: fetchImpl = fetch,
  cacheMs = 300_000,
  timeoutMs = 10_000,
}: PluginStoreDeps): PluginStore {
  const base = new URL(catalogUrl);
  let cached: { at: number; catalog: Catalog } | undefined;

  /** GET sem redirect (não sai da origem) e com teto de tamanho enquanto lê. */
  const get = async (url: URL, maxBytes: number): Promise<Buffer> => {
    try {
      const res = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok || !res.body) throw unavailable(`HTTP ${res.status}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) throw unavailable('resposta grande demais');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err instanceof PluginError) throw err;
      throw unavailable('falha de rede');
    }
  };

  const catalog = async (): Promise<Catalog> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.catalog;
    const raw = await get(base, MAX_CATALOG_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw unavailable('índice ilegível');
    }
    const parsed = catalogSchema.safeParse(json);
    if (!parsed.success) throw unavailable('índice em formato inválido');
    cached = { at: Date.now(), catalog: parsed.data };
    return parsed.data;
  };

  return {
    catalog,
    async download(id, version) {
      const entry = (await catalog()).plugins
        .find((p) => p.id === id)
        ?.versions.find((v) => v.version === version);
      if (!entry) {
        throw new PluginError('plugin_not_found', 'Versão não encontrada no catálogo.');
      }
      const url = new URL(entry.url, base);
      if (url.origin !== base.origin) throw unavailable('pacote fora do endereço da loja');
      const archive = await get(url, MAX_ARCHIVE_BYTES);
      if (sha256(archive) !== entry.sha256) {
        throw new PluginError('invalid_package', 'O pacote baixado não confere com o catálogo.');
      }
      return { archive, signature: Buffer.from(entry.signature, 'base64') };
    },
  };
}

const compareVersions = (a: string, b: string) => {
  const x = a.split('-')[0]!.split('.').map(Number);
  const y = b.split('-')[0]!.split('.').map(Number);
  return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
};

/** Item da loja como a tela precisa: compatibilidade, versão instalada e atualização. */
export function describeCatalogPlugin(
  plugin: CatalogPlugin,
  installedVersion: string | null,
  compatible: (range: string) => boolean,
) {
  const versions = plugin.versions
    .map((v) => ({ version: v.version, compatible: compatible(v.kernelApi) }))
    .sort((a, b) => compareVersions(b.version, a.version));
  const latest = versions.find((v) => v.compatible)?.version ?? null;
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description ?? null,
    repository: plugin.repository ?? null,
    versions,
    latest,
    installedVersion,
    updateAvailable: Boolean(
      latest && installedVersion && compareVersions(latest, installedVersion) > 0,
    ),
  };
}
