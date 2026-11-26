// Spike (#53): upgrade de plugin ESM sem restart via import() com cache-busting.
// Uso: node --expose-gc run.mjs [upgrades=200]
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const upgrades = Number(process.argv[2] ?? 200);
const dir = await mkdtemp(join(tmpdir(), 'plugin-spike-'));
const file = join(dir, 'plugin.mjs');
// payload ~100 KB por versão para o vazamento ficar mensurável
const filler = 'x'.repeat(100_000);

async function load(version) {
  await writeFile(
    file,
    `const pad = ${JSON.stringify(filler)};\nexport default { version: ${version}, hello: () => 'v${version}', size: pad.length };\n`,
  );
  const mod = await import(`${pathToFileURL(file).href}?v=${version}`);
  return mod.default;
}

const heap = () => {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
};

const v1 = await load(1);
assert.equal(v1.hello(), 'v1');
const v2 = await load(2);
assert.equal(v2.hello(), 'v2');
assert.equal(v1.hello(), 'v1', 'referência antiga continua válida');

const before = heap();
const t0 = performance.now();
for (let v = 3; v < 3 + upgrades; v++) assert.equal((await load(v)).hello(), `v${v}`);
const ms = (performance.now() - t0) / upgrades;
const leakKb = (heap() - before) / 1024 / upgrades;

await rm(dir, { recursive: true, force: true });
console.log(
  JSON.stringify({
    node: process.version,
    upgrades,
    msPerUpgrade: +ms.toFixed(2),
    heapKbPerUpgrade: +leakKb.toFixed(1),
    bundleKb: 100,
  }),
);
