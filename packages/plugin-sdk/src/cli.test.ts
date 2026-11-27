import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEnv, create, lintStyles, main, MANIFEST_FILE, pack, signFile } from './cli.js';
import { PACKAGE_FORMAT } from './package.js';

describe('CLI plantao-plugin', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'plantao-plugin-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
  });

  it('create gera o projeto com manifesto, server, web e CSS dentro do escopo', async () => {
    const dir = path.join(tmp, 'contacts');
    await create('contacts', dir);
    const manifest = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), 'utf8'));
    expect(manifest).toMatchObject({ id: 'contacts', version: '0.1.0', kernelApi: '^1.1.0' });
    const vite = await readFile(path.join(dir, 'web/vite.config.ts'), 'utf8');
    expect(vite).toContain("name: 'plugin_contacts'");
    // root relativo faz o plugin carregar um React próprio e quebrar no host
    expect(vite).toContain("root: fileURLToPath(new URL('.', import.meta.url))");
    expect(await readFile(path.join(dir, 'web/index.html'), 'utf8')).toContain('<body>');
    // o CSS do template passa no próprio lint
    await mkdir(path.join(dir, 'dist/web'), { recursive: true });
    const css = await readFile(path.join(dir, 'web/styles.css'), 'utf8');
    await writeFile(path.join(dir, 'dist/web/style.css'), css);
    expect(await lintStyles(dir, 'contacts')).toEqual([]);

    await expect(create('contacts', dir)).rejects.toThrow(/já existe/);
    await expect(create('Bad_Id', path.join(tmp, 'x'))).rejects.toThrow(/id inválido/);
  });

  it('create aponta os SDKs para a versão publicada junto com a CLI', async () => {
    const dir = path.join(tmp, 'contacts');
    await create('contacts', dir);
    const readJson = async (file: string | URL) => JSON.parse(await readFile(file, 'utf8'));
    const { version } = await readJson(new URL('../package.json', import.meta.url));
    const web = await readJson(new URL('../../web-sdk/package.json', import.meta.url));
    // o release publica os dois com a mesma versão; se divergirem, a faixa derivada não serve
    expect(web.version).toBe(version);
    const { devDependencies } = await readJson(path.join(dir, 'package.json'));
    expect(devDependencies).toMatchObject({
      '@plantao365/plugin-sdk': `^${version}`,
      '@plantao365/web-sdk': `^${version}`,
    });
  });

  it('lint aponta arquivo e linha do CSS fora do padrão', async () => {
    await mkdir(path.join(tmp, 'dist/web/assets'), { recursive: true });
    await writeFile(path.join(tmp, 'dist/web/assets/a.css'), '.plg-x {}\n.btn { color: red; }');
    expect(await lintStyles(tmp, 'x')).toEqual([
      'web/assets/a.css:2 Seletor fora do escopo ".btn"; comece por .plg-x.',
    ]);
  });

  it('pack junta dist e migrations; sign assina o arquivo do pacote', async () => {
    await mkdir(path.join(tmp, 'dist/server'), { recursive: true });
    await mkdir(path.join(tmp, 'migrations'), { recursive: true });
    const manifest = { id: 'x', name: 'X', version: '1.2.3', server: { entry: 'server/index.js' } };
    await writeFile(path.join(tmp, 'dist', MANIFEST_FILE), JSON.stringify(manifest));
    await writeFile(path.join(tmp, 'dist/server/index.js'), 'export default {}');
    await writeFile(path.join(tmp, 'migrations/0001_a.up.sql'), 'create table a ();');
    await writeFile(path.join(tmp, 'migrations/notes.txt'), 'ignorado');

    const file = await pack(tmp);
    expect(path.basename(file)).toBe('x-1.2.3.p365');
    const decoded = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'));
    expect(decoded.format).toBe(PACKAGE_FORMAT);
    expect(decoded.manifest).toEqual(manifest);
    expect(Object.keys(decoded.files).sort()).toEqual([
      'migrations/0001_a.up.sql',
      'server/index.js',
    ]);

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const sigFile = await signFile(
      file,
      privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    );
    expect(verify(null, await readFile(file), publicKey, await readFile(sigFile))).toBe(true);
  });

  it('build roda o vite como produção, sem o env do vitest (senão o MF não gera remoteEntry)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VITEST', 'true');
    const env = buildEnv({ id: 'x', version: '1.0.0' });
    vi.unstubAllEnvs();
    expect(env).toMatchObject({ NODE_ENV: 'production', PLUGIN_ID: 'x', PLUGIN_VERSION: '1.0.0' });
    expect(Object.keys(env).filter((k) => k.startsWith('VITEST'))).toEqual([]);
  });

  it('pack sem build e install sem argumentos falham com mensagem', async () => {
    expect(await main(['pack', tmp])).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Rode `plantao-plugin build` antes do pack.');
    expect(await main(['install', 'x.p365'])).toBe(1);
    expect(await main([])).toBe(0);
    expect(await main(['desconhecido'])).toBe(1);
  });
});
