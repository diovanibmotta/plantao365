/*
 * Sobe o ambiente do E2E: compila e assina o plugin de referência, recria o banco, migra e roda a
 * API servindo o build do front. Pede `npm run build` antes. Usado pelo webServer do Playwright.
 */
import { execSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signFile } from '@diovanibmotta/plantao365-plugin-sdk/cli';
import postgres from 'postgres';
import * as env from './env.js';

const run = (command: string, cwd: string, extra: Record<string, string> = {}) =>
  execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, ...extra } });

await rm(env.WORK_DIR, { recursive: true, force: true });
await mkdir(env.WORK_DIR, { recursive: true });

// Fora do repositório, para o plugin resolver só as próprias dependências (como o autor faria).
const source = await mkdtemp(path.join(tmpdir(), 'p365-plugin-'));
const tarball = await fetch(
  `https://codeload.github.com/${env.PLUGIN_REPO}/tar.gz/${env.PLUGIN_SHA}`,
);
if (!tarball.ok) throw new Error(`download do plugin falhou: HTTP ${tarball.status}`);
await writeFile(path.join(source, 'plugin.tar.gz'), Buffer.from(await tarball.arrayBuffer()));
run('tar -xzf plugin.tar.gz --strip-components=1', source);
run('npm ci --no-audit --no-fund', source);
run('npm run build', source);
const archive = (await readdir(source)).find((f) => f.endsWith('.p365'));
if (!archive) throw new Error('o build do plugin não gerou .p365');
await copyFile(path.join(source, archive), env.PLUGIN_ARCHIVE);
await rm(source, { recursive: true, force: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
await signFile(env.PLUGIN_ARCHIVE, privateKey.export({ format: 'pem', type: 'pkcs8' }) as string);

const admin = postgres(env.ADMIN_DATABASE_URL, { max: 1, onnotice: () => undefined });
await admin.unsafe(`drop database if exists ${env.E2E_DATABASE} with (force)`);
await admin.unsafe(`create database ${env.E2E_DATABASE}`);
await admin.end();

const databaseUrl = new URL(env.ADMIN_DATABASE_URL);
databaseUrl.pathname = `/${env.E2E_DATABASE}`;
const apiEnv = {
  NODE_ENV: 'test',
  PORT: String(env.PORT),
  LOG_LEVEL: 'warn',
  APP_BASE_URL: env.BASE_URL,
  DATABASE_URL: databaseUrl.href,
  MASTER_USERNAME: env.MASTER.username,
  MASTER_PASSWORD: env.MASTER.password,
  PLUGIN_PUBLIC_KEYS: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  PLUGIN_INSTALL_TOKEN: env.INSTALL_TOKEN,
  PLUGINS_DIR: path.resolve(env.WORK_DIR, 'cache'),
  WEB_DIST_DIR: path.resolve('apps/web/dist'),
};
run('node apps/api/dist/migrate.js up', '.', apiEnv);

const api = spawn(process.execPath, ['apps/api/dist/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, ...apiEnv },
});
api.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => api.kill(signal));
