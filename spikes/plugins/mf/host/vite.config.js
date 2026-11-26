import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { fileURLToPath } from 'node:url';
import { shared } from '../shared.js';

// Host sem remotes no build: eles são registrados em runtime a partir do manifesto.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), federation({ name: 'host', remotes: {}, shared, dts: false })],
  build: { target: 'esnext' },
  preview: { port: 4173 },
});
