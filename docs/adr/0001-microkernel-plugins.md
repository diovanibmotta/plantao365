# ADR 0001: arquitetura microkernel com plugins em runtime

- **Status:** aceito (Fase 0 do milestone "Microkernel / Plugins", issue #53, feature #52)
- **Data:** 2026-11-26
- **Documentação técnica:** [wiki, Plugins](https://github.com/diovanibmotta/plantao365/wiki/Plugins), com as [diferenças entre esta decisão e o que foi entregue](https://github.com/diovanibmotta/plantao365/wiki/Plugins#diferenças-em-relação-à-adr-e-ao-plano-original)

## Contexto

Toda funcionalidade nova hoje exige alterar o core:

- `apps/api/src/app.ts` monta routers e callbacks (`onPublished`, `onSwapEvent`, `scheduleImpactNotifier`…) à mão.
- `apps/api/src/index.ts` inicia os jobs à mão.
- `DomainEventMap` é fechado, e `createEventHandlers` devolve `Required<EventHandlers>` (um handler por evento).
- Há um único diretório de migrações, e `schema_migrations` não sabe a que módulo cada migração pertence.
- No web, as rotas (`App.tsx`), o menu (`NAV_ITEMS`/`NavIcon`) e as rotas de leitura de guest (`GUEST_READ_PATHS`) são listas fixas.

Queremos adicionar telas, tabelas, endpoints, assinantes de evento, jobs e ajustes de regra por **plugin**, sem tocar no core.

Premissas:

- Os plugins são escritos pelo time interno (código confiável, sem sandbox).
- O deploy é de uma instância por cliente.
- A instalação é em **runtime (hot install)**.

## Decisão

1. **Kernel mínimo** na API (`apps/api/src/plugins/`) e no web (`apps/web/src/plugins/`).
   - O kernel cuida do ciclo de vida: install → migrate → enable → disable → uninstall.
   - O core existente vira consumidor dos mesmos pontos de extensão.
2. **Pacote de plugin** `.tgz` contendo:
   - `plugin.json`: id, version, `kernelApi` semver, permissões e slots
   - `server/index.js` (ESM, `definePlugin`)
   - `migrations/`
   - `web/` (remote Module Federation)
3. **Assinatura Ed25519 obrigatória** com a chave do time, verificada no install (`PLUGIN_PUBLIC_KEYS`). Hot install executa código no processo; sem assinatura válida, não instala.
4. **Distribuição:**
   - O bundle fica no banco (`plugin_packages`) e é extraído em `PLUGINS_DIR` em cada réplica.
   - As réplicas sincronizam via `LISTEN/NOTIFY plugins_changed`.
5. **Back, carga e upgrade:** `import()` dinâmico com cache-busting (`file.js?v=<hash>`).
   - Desabilitar tira o plugin do dispatcher; o módulo continua em memória.
   - O roteamento usa um único `app.route('/api/plugins', dispatcher)`, sem remontar o Hono.
6. **Dados:** cada plugin cria tabelas só no schema `plugin_<id>`.
   - As migrações usam o migrator generalizado, com a coluna `schema_migrations.scope`.
   - O uninstall mantém os dados por padrão; o purge faz `drop schema`.
7. **Eventos com fan-out por assinante:** cada entrega é uma linha em `domain_event_deliveries`.
   - Eventos de plugin usam o namespace `<pluginId>.<evento>`.
   - As notificações do core viram o assinante `core.notifications`.
8. **Regras de escala:** `generateRotation` aceita `adjusters` puros e síncronos (elegibilidade e pontuação), mantendo `packages/shared` determinístico.
   - Os dados do plugin são carregados antes, num hook assíncrono `rotation.prepare`.
   - Mutações de plugin que afetam escala publicada passam por `runScheduleImpact`.
9. **Web:** Module Federation em runtime (`@module-federation/vite` + `@module-federation/runtime`, `registerRemotes`/`loadRemote`).
   - O host lê o manifesto (`GET /api/plugins/manifest`) e registra os remotes sem rebuild.
   - `react`, `react-dom`, `react-router` e `@plantao365/web-sdk` são singletons compartilhados.
   - Cada plugin renderiza dentro de um ErrorBoundary próprio.
10. **Identidade visual preservada (obrigatório):**
    - Os plugins usam só os tokens CSS e os componentes do `web-sdk` (`PageHeader`, `FilterBar`, `FormPage`…).
    - O CSS do plugin é escopado, e a CLI barra seletores globais, `!important` e cores fora de token.
    - Os ícones seguem a moldura de `layout/icons.tsx`.
    - Os e-mails usam o layout base.
    - Há regressão visual no CI.
11. **Falha isolada:**
    - Hooks rodam em savepoint (`runHookInSavepoint`) e com timeout.
    - Um plugin com erro repetido vai para `failed` sem derrubar o core nem o boot.

## Resultados dos spikes

Os spikes ficam em `spikes/plugins/` (fora dos workspaces, sem build nem lint).

### Spike 1: hot reload de ESM no Node (`spikes/plugins/node-hot-reload/run.mjs`)

Rodado em Node v24.14.1 com `node --expose-gc run.mjs <N>` e um bundle de ~100 KB por versão:

| Upgrades | ms por upgrade | Heap retido por upgrade |
| -------- | -------------- | ----------------------- |
| 200      | 2,54           | 103,8 KB                |
| 1000     | 2,34           | 102,6 KB                |

- Funcionou: o `import()` com `?v=<hash>` carrega a nova versão, e uma referência antiga continua válida, sem quebrar requests em voo.
- **O módulo antigo nunca é liberado:** o heap retido por upgrade é aproximadamente o tamanho do bundle. Com bundles típicos de 100 KB a 1 MB, dezenas de upgrades entre restarts são aceitáveis.
- Mitigação: restart em janela de manutenção, ou rolling restart no k8s após upgrades, documentado no guia de operação.

### Spike 2: Module Federation em runtime (`spikes/plugins/mf/`)

O host foi buildado uma vez, sem remotes. O plugin `demo` foi buildado em duas versões e servido na mesma origem em `/plugins-assets/demo/<versão>/`, como a API fará. O manifesto é lido em runtime. Validação feita no browser com `vite preview`:

- ✅ O remote renderizou dentro do host, e `useState` funcionou após um clique: há uma instância só do React.
- ✅ `useLocation()` do remote leu o `BrowserRouter` do host (`location=/some/route`): `react-router` é singleton.
- ✅ O `useSdk()` do remote leu o valor fornecido pelo host: o `web-sdk` é singleton. O plugin não baixou suas cópias de fallback de react e react-router.
- ✅ Trocar `entry` no manifesto de v1 para v2 carregou a v2 após o reload, sem rebuild do host.
- ✅ Com um entry inexistente, o ErrorBoundary exibiu a falha (`RUNTIME-008`) e o host continuou de pé, sem tela branca.
- Versões usadas: `@module-federation/vite` 1.23.11, `@module-federation/runtime` 2.9.3, React 19.3.1, react-router 7.18.6, Vite 8.3.8.
- Observação: o build do remote exige um `index.html` mínimo como entrada.

## Consequências

- **Positivas:**
  - Funcionalidade de cliente entra sem redeploy.
  - O core fica menor, com contratos explícitos.
  - Os pontos de extensão também passam a servir ao próprio core.
- **Negativas e limites:**
  - Cada hook vira contrato público, versionado por `KERNEL_API_VERSION`. Começamos com poucos hooks.
  - Upgrades acumulam memória até o restart (ver spike 1).
  - Uma versão divergente das dependências compartilhadas quebra o plugin. Mitigação: o install checa os ranges de peer deps contra o host.
  - O CSP continua `script-src 'self'`, porque os assets são servidos na mesma origem.
  - A superfície de ataque cresce, o que torna a assinatura e o install restrito (master ou manager autorizado, com audit) inegociáveis.

## Release

O milestone fecha com **versão major (2.0.0)**:

- Pelo menos um commit 💥 com rodapé `BREAKING CHANGE:` na branch `feat/microkernel-plugins`.
- Merge na `main` com `gh pr merge --merge`, nunca squash.
