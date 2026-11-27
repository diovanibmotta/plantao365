import { spawnSync } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { encodePackage } from './package.js';
import { checkPluginStyles } from './style-check.js';
import { scaffold } from './templates.js';

/*
 * plantao-plugin: create, build, pack, keygen, sign e install de plugins do Plantão365.
 * Projeto do plugin: `plantao365.plugin.json` (manifesto), `server/index.ts`, `web/` (Vite + Module
 * Federation) e `migrations/`. O build sai em `dist/`; o pack gera `<id>-<versão>.p365`.
 */

export const MANIFEST_FILE = 'plantao365.plugin.json';
const KERNEL_API = '^1.1.0';

interface Manifest {
  id: string;
  name: string;
  version: string;
  server?: { entry: string };
  web?: { entry: string };
  styleCheck?: 'passed';
  [key: string]: unknown;
}

class CliError extends Error {}

const readManifest = async (dir: string): Promise<Manifest> => {
  const file = path.join(dir, MANIFEST_FILE);
  if (!existsSync(file)) throw new CliError(`${MANIFEST_FILE} não encontrado em ${dir}.`);
  return JSON.parse(await readFile(file, 'utf8')) as Manifest;
};

/** Arquivos de uma pasta, com caminho relativo em barra normal (como o pacote exige). */
async function listFiles(root: string, rel = ''): Promise<string[]> {
  if (!existsSync(path.join(root, rel))) return [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, child)));
    else out.push(child);
  }
  return out;
}

export async function create(id: string, dir: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) {
    throw new CliError('id inválido: minúsculas, números e hífen, começando por letra.');
  }
  if (existsSync(dir)) throw new CliError(`${dir} já existe.`);
  for (const [rel, content] of Object.entries(scaffold(id, KERNEL_API))) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
}

/** Lint de estilo do CSS gerado; vazio = passou. */
export async function lintStyles(dir: string, id: string): Promise<string[]> {
  const dist = path.join(dir, 'dist');
  const css = (await listFiles(dist)).filter((f) => f.endsWith('.css'));
  const violations = await Promise.all(
    css.map(async (f) => checkPluginStyles(await readFile(path.join(dist, f), 'utf8'), id, f)),
  );
  return violations.flat().map((v) => `${v.file}:${v.line} ${v.message}`);
}

/**
 * Env do `vite build`: herdado, mas sempre de produção. Com NODE_ENV=test ou VITEST (build
 * chamado de dentro de testes/CI) o Module Federation não gera o remoteEntry.js.
 */
export function buildEnv(manifest: { id: string; version: string }): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')),
  );
  return {
    ...env,
    NODE_ENV: 'production',
    PLUGIN_ID: manifest.id,
    PLUGIN_VERSION: manifest.version,
  };
}

async function build(dir: string): Promise<void> {
  const manifest = await readManifest(dir);
  const dist = path.join(dir, 'dist');
  await rm(dist, { recursive: true, force: true });
  const out: Manifest = { ...manifest };
  delete out.styleCheck;

  if (existsSync(path.join(dir, 'server/index.ts'))) {
    // esbuild só é necessário no build; import dinâmico para não pesar no kernel.
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [path.join(dir, 'server/index.ts')],
      outfile: path.join(dist, 'server/index.js'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      // O kernel injeta tudo pelo ctx; hono/postgres ficam no host.
      external: ['hono', 'postgres'],
    });
    out.server = { entry: 'server/index.js' };
  }

  if (existsSync(path.join(dir, 'web/vite.config.ts'))) {
    // Comando fixo (sem entrada do usuário); shell para achar o npx.cmd no Windows.
    const res = spawnSync('npx vite build --config web/vite.config.ts', {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
      env: buildEnv(manifest),
    });
    if (res.status !== 0) throw new CliError('vite build falhou.');
    out.web = { entry: 'web/remoteEntry.js' };
    const errors = await lintStyles(dir, manifest.id);
    if (errors.length > 0) {
      throw new CliError(`Lint de estilo reprovado:\n  ${errors.join('\n  ')}`);
    }
    out.styleCheck = 'passed';
  }

  await writeFile(path.join(dist, MANIFEST_FILE), `${JSON.stringify(out, null, 2)}\n`);
}

/** Monta o pacote a partir de `dist/` e `migrations/`. */
export async function pack(dir: string, output?: string): Promise<string> {
  const dist = path.join(dir, 'dist');
  const manifest = await readManifest(dist).catch(() => {
    throw new CliError('Rode `plantao-plugin build` antes do pack.');
  });
  const files: Record<string, Buffer> = {};
  for (const rel of await listFiles(dist)) {
    if (rel !== MANIFEST_FILE) files[rel] = await readFile(path.join(dist, rel));
  }
  for (const rel of await listFiles(path.join(dir, 'migrations'))) {
    if (rel.endsWith('.sql')) {
      files[`migrations/${rel}`] = await readFile(path.join(dir, 'migrations', rel));
    }
  }
  const file = output ?? path.join(dir, `${manifest.id}-${manifest.version}.p365`);
  await writeFile(file, encodePackage(manifest, files));
  return file;
}

/** Par Ed25519: privada em PEM (guarde fora do repositório) e pública para PLUGIN_PUBLIC_KEYS. */
async function keygen(outDir: string): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await mkdir(outDir, { recursive: true });
  const keyFile = path.join(outDir, 'plugin-signing.pem');
  await writeFile(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

export async function signFile(file: string, keyPem: string): Promise<string> {
  const key = createPrivateKey(keyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new CliError('A chave precisa ser Ed25519.');
  const sigFile = `${file}.sig`;
  await writeFile(sigFile, sign(null, await readFile(file), key));
  return sigFile;
}

async function install(file: string, url: string, token: string): Promise<string> {
  const sigFile = `${file}.sig`;
  if (!existsSync(sigFile)) throw new CliError(`Assinatura ${sigFile} não encontrada; rode sign.`);
  const body = JSON.stringify({
    archive: (await readFile(file)).toString('base64'),
    signature: (await readFile(sigFile)).toString('base64'),
  });
  const res = await fetch(new URL('/api/plugins', url), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-requested-with': 'plantao360',
    },
    body,
  }).catch((err: unknown) => {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
    throw new CliError(`Não foi possível conectar a ${url}${cause ? ` (${cause})` : ''}.`);
  });
  const reply = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok)
    throw new CliError(`Install recusado (${res.status}): ${reply.message ?? reply.error}`);
  return reply.message ?? 'Plugin instalado.';
}

const USAGE = `Uso: plantao-plugin <comando>
  create <id> [--dir <pasta>]           cria o projeto do plugin
  build [pasta]                         compila server e web e roda o lint de estilo
  pack [pasta] [--out <arquivo>]        gera <id>-<versão>.p365 a partir do dist
  keygen [--out <pasta>]                gera par Ed25519 (imprime a chave pública)
  sign <arquivo> --key <pem>            grava <arquivo>.sig
  install <arquivo> --url <base> [--token <t>]
                                        envia para a API (token ou env PLANTAO365_PLUGIN_TOKEN)`;

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      key: { type: 'string' },
      url: { type: 'string' },
      token: { type: 'string' },
    },
  });
  const [command, arg] = positionals;
  try {
    switch (command) {
      case 'create':
        if (!arg) throw new CliError('Informe o id do plugin.');
        await create(arg, values.dir ?? arg);
        console.log(`Plugin ${arg} criado em ${values.dir ?? arg}.`);
        return 0;
      case 'build':
        await build(arg ?? '.');
        console.log('Build ok; lint de estilo aprovado.');
        return 0;
      case 'pack':
        console.log(`Pacote: ${await pack(arg ?? '.', values.out)}`);
        return 0;
      case 'keygen':
        console.log(`Chave pública (PLUGIN_PUBLIC_KEYS): ${await keygen(values.out ?? '.')}`);
        return 0;
      case 'sign':
        if (!arg || !values.key) throw new CliError('Uso: sign <arquivo> --key <pem>');
        console.log(`Assinatura: ${await signFile(arg, await readFile(values.key, 'utf8'))}`);
        return 0;
      case 'install': {
        const token = values.token ?? process.env.PLANTAO365_PLUGIN_TOKEN;
        if (!arg || !values.url || !token) {
          throw new CliError('Uso: install <arquivo> --url <base> --token <t>');
        }
        console.log(await install(arg, values.url, token));
        return 0;
      }
      default:
        console.log(USAGE);
        return command ? 1 : 0;
    }
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    console.error(err.message);
    return 1;
  }
}
