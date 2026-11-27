/** Arquivos do projeto criado por `plantao-plugin create <id>`. */
export function scaffold(id: string, kernelApi: string): Record<string, string> {
  const remote = `plugin_${id.replace(/-/g, '_')}`;
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  return {
    'plantao365.plugin.json': json({
      id,
      name: id,
      version: '0.1.0',
      description: '',
      kernelApi,
      settingsSchema: {
        type: 'object',
        properties: {
          greeting: { type: 'string', title: 'Saudação', maxLength: 80, default: 'Olá' },
        },
      },
    }),
    'package.json': json({
      name: `plantao365-plugin-${id}`,
      private: true,
      type: 'module',
      scripts: { build: 'plantao-plugin build', pack: 'plantao-plugin pack' },
      devDependencies: {
        '@diovanibmotta/plantao365-plugin-sdk': '^1.30.0',
        '@diovanibmotta/plantao365-web-sdk': '^1.30.0',
        '@module-federation/vite': '1.23.11',
        '@vitejs/plugin-react': '^6.3.0',
        esbuild: '^0.28.0',
        react: '^19.3.1',
        'react-router': '^7.18.6',
        typescript: '^6.0.3',
        vite: '^8.3.8',
      },
    }),
    '.gitignore': 'node_modules\ndist\n*.p365\n*.sig\n*.pem\n',
    'server/index.ts': `import { definePlugin } from '@diovanibmotta/plantao365-plugin-sdk';

export default definePlugin({
  setup(ctx) {
    // Rotas em /api/extensions/${id}/...
    ctx.router.get('/hello', ctx.auth.requireAuth(), (c) =>
      c.json({ message: String(ctx.settings.greeting ?? 'Olá') }),
    );
  },
});
`,
    'web/index.tsx': `import { useEffect, useState } from 'react';
import { api, definePluginWeb, pluginApi, PluginPage } from '@diovanibmotta/plantao365-web-sdk';
import './styles.css';

const url = pluginApi('${id}');

function Home() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    api.get<{ message: string }>(url('/hello')).then((r) => setMessage(r.message));
  }, []);
  return (
    <PluginPage title="${id}" description="Tela do plugin.">
      <p className="greeting">{message}</p>
    </PluginPage>
  );
}

export default definePluginWeb({
  routes: [{ path: '', component: Home }],
  nav: [{ label: '${id}', group: 'schedule', icon: ['M12 3v18', 'M3 12h18'] }],
});
`,
    // Todo seletor começa por .plg-<id> (o host aplica essa classe) e só usa tokens semânticos.
    'web/styles.css': `.plg-${id} .greeting {
  color: var(--muted);
  margin-block: var(--space);
}
`,
    'web/vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { fileURLToPath } from 'node:url';

// PLUGIN_ID e PLUGIN_VERSION vêm do \`plantao-plugin build\`; os assets são servidos pela API.
const id = process.env.PLUGIN_ID ?? '${id}';
const version = process.env.PLUGIN_VERSION ?? '0.0.0';

export default defineConfig({
  root: 'web',
  base: \`/plugins-assets/\${id}/\${version}/web/\`,
  plugins: [
    react(),
    federation({
      name: '${remote}',
      filename: 'remoteEntry.js',
      exposes: { './web': './index.tsx' },
      // Mesmos singletons do host: o plugin usa o React, o router e o web-sdk do app.
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        'react-router': { singleton: true },
        '@diovanibmotta/plantao365-web-sdk': { singleton: true },
      },
      dts: false,
    }),
  ],
  build: {
    target: 'esnext',
    outDir: '../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      // Remote sem página: a entrada é o módulo exposto (sem isso o Vite procura web/index.html).
      input: fileURLToPath(new URL('./index.tsx', import.meta.url)),
      // Nomes curtos: os chunks do MF repetem o id e os shared e o kernel limita o caminho a 200.
      output: { chunkFileNames: 'assets/[hash].js', assetFileNames: 'assets/[hash][extname]' },
    },
  },
});
`,
    // Rodam no schema plugin_<id>, uma vez (advisory lock entre réplicas).
    'migrations/0001_init.up.sql':
      'create table notes (id serial primary key, body text not null);\n',
    'migrations/0001_init.down.sql': 'drop table notes;\n',
    'tsconfig.json': json({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        // import de CSS nos componentes
        types: ['vite/client'],
      },
      include: ['server', 'web'],
    }),
    'README.md': `# Plugin ${id}

\`\`\`sh
npm install
npx plantao-plugin build      # server (esbuild), web (Vite + MF) e lint de estilo
npx plantao-plugin pack       # ${id}-<versão>.p365
npx plantao-plugin sign ${id}-0.1.0.p365 --key plugin-signing.pem
npx plantao-plugin install ${id}-0.1.0.p365 --url https://plantao.exemplo --token $PLANTAO365_PLUGIN_TOKEN
\`\`\`

Siga o checklist visual do web-sdk: CSS sob \`.plg-${id}\`, só tokens semânticos.
`,
  };
}
