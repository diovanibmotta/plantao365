# Plugins

Guia do autor de plugins do Plantão365: como criar, o que o kernel oferece e como o contrato evolui. A decisão de arquitetura está na [ADR 0001](adr/0001-microkernel-plugins.md). O plugin de referência fica em repositório próprio: [plugin-emergency-contacts](https://github.com/plantao365/plugin-emergency-contacts).

## Quando é plugin

Funcionalidade opcional ou de um cliente específico vai como plugin, não no core. O core fica com o que toda instalação usa: escala, trocas, saldo, férias, feriados, equipes e auditoria. Se a funcionalidade precisa de um ponto de extensão que não existe, o ponto entra no kernel e a funcionalidade vira plugin.

## Ciclo do autor

```sh
npx plantao-plugin create meu-plugin                  # projeto novo
npx plantao-plugin build                              # server (esbuild), web (Vite + MF) e lint de estilo
npx plantao-plugin pack                               # meu-plugin-<versão>.p365
npx plantao-plugin sign meu-plugin-0.1.0.p365 --key plugin-signing.pem
npx plantao-plugin install meu-plugin-0.1.0.p365 --url https://plantao.exemplo --token "$PLANTAO365_PLUGIN_TOKEN"
```

Depois do install, um gestor habilita e configura em **Configuração › Plugins** (`/plugins`). Detalhes da CLI, do projeto e das variáveis do servidor no [README do plugin-sdk](../packages/plugin-sdk/README.md).

Plugins não moram neste repositório: cada um tem o seu e é instalado como pacote. No core, `apps/api/src/plugins/scaffold-plugin.test.ts` testa o caminho do autor sobre o projeto que a CLI gera (create → build → pack → sign → install por token → enable → rota, migração e front) contra o Postgres do CI. O navegador fica com o job `e2e`, a regressão visual do plugin de referência (ver [CONTRIBUTING](../CONTRIBUTING.md#e2e-de-navegador-playwright)).

O `plugin-sdk` e o `web-sdk` são publicados no GitHub Packages a cada release (a instalação pede um token com `read:packages` no `.npmrc`).

## Instalação

Nesta versão a instalação é só manual: pela CLI ou em **Instalar de arquivo**, que avisa do risco e pede confirmação (a CLI e a API não pedem; ver [#88](https://github.com/plantao365/app/issues/88)). A tela **Configuração › Plugins** tem as abas **Instalados** e **Chaves**. Qualquer gestor instala, habilita, configura e remove; cadastrar uma chave pública permite instalar pacotes daquele publicador. Todo gestor, portanto, consegue executar código no servidor.

## Loja (desligada até a v3)

O código da loja existe, mas está desligado ([#73](https://github.com/plantao365/app/issues/73)): sem aba na tela, e o catálogo da API responde `store_disabled` mesmo com `PLUGIN_CATALOG_URL` preenchida. Para religar, mude `PLUGIN_STORE_ENABLED` em `apps/api/src/plugins/store.ts` e em `apps/web/src/plugins-admin/paths.ts`, e devolva a variável aos arquivos de deploy.

A loja é um `catalog.json` estático com os pacotes ao lado, servido por CDN sobre um bucket privado; a infraestrutura fica fora deste repositório. A URL e a chave da loja oficial são constantes em `apps/api/src/plugins/store.ts`; `PLUGIN_CATALOG_URL` troca o endereço (`off` desliga). A API só baixa pacotes da mesma origem do índice, sem seguir redirect, e confere sha256, assinatura, plugin e versão.

## Pontos de extensão

### Servidor (`definePlugin({ setup(ctx) })`)

| `ctx`                                                   | Uso                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `router`                                                | Rotas em `/api/extensions/<id>/...`, já com sessão, CSRF e equipe ativa (`c.get('user')`, `c.get('teamId')`).                        |
| `auth.requireAuth()` / `auth.requireRole('manager')`    | Mesmas regras do core. Convidado só lê o que o manifesto lista em `guestReadPaths`.                                                  |
| `db`, `withSchema(fn)`                                  | SQL (`postgres.js`). `withSchema` abre transação com `search_path` no schema `plugin_<id>`.                                          |
| migrações (`migrations/NNNN_nome.up.sql` / `.down.sql`) | Rodam no schema do plugin ao ativar, uma vez entre réplicas (advisory lock). Nunca edite migração publicada.                         |
| `audit(tx, entry)`                                      | Grava no `audit_log`; a ação ganha o prefixo `<id>.`. Toda mutação feita por gestor audita na mesma transação.                       |
| `events.publish` / `events.subscribe`                   | Outbox de eventos do core. Assine eventos do core (ex.: `team.member_added`) ou de outros plugins; erro no handler = nova tentativa. |
| `enqueueEmail(tx, email)`                               | E-mail na outbox do core com o layout base. O plugin manda texto (parágrafos, linhas, ação); nunca HTML próprio.                     |
| `jobs.register({ name, intervalMs, run })`              | Job periódico (mínimo 1 s); parado no disable/upgrade.                                                                               |
| `hooks.rotation.prepare` / `hooks.swaps.beforeAction`   | Ajustes na geração da escala e veto de ações de troca.                                                                               |
| `scheduleImpact.run(tx, trigger)`                       | Regra core: mutação que pode invalidar plantão publicado passa por aqui, na transação.                                               |
| `settings`                                              | Configuração salva pela master key, validada contra o `settingsSchema` do manifesto.                                                 |

### Front (`definePluginWeb({ routes, nav, slots })`)

- **Rotas**: em `/ext/<id>/<path>`, com papel mínimo por rota (`role`).
- **Menu**: `nav` com grupo (`schedule` ou `admin`), papel e ícone como dados `d` de paths SVG 24x24 em traço.
- **Slots**: `schedule.toolbar`, `my-schedule.aside` e `profile.sections`. O host dá a moldura e o isolamento de erro.
- **Componentes e serviços**: só do `web-sdk` (`PluginPage`, `PageHeader`, `FilterBar`, `ui-table`, `FormPage`/`FormSection`/`FormActions`, `ConfirmDialog`, `EmptyState`, `Pagination`, `api`, `toast`, `useRole`, `useActiveTeam`). Siga o padrão de telas do [CLAUDE.md](../CLAUDE.md) e o [checklist visual](../packages/web-sdk/README.md#checklist-visual-do-plugin).
- **CSS**: todo seletor sob `.plg-<id>` (o host aplica essa classe), só tokens semânticos. A CLI reprova no build e o kernel reprova no install o que fugir disso.

### Manifesto (`plantao365.plugin.json`)

`id`, `name`, `version` (semver), `description`, `kernelApi`, `guestReadPaths`, `settingsSchema`. A CLI acrescenta `server`, `web` e `styleCheck` no build.

## Versionamento do contrato (`KERNEL_API_VERSION`)

O contrato do kernel tem versão própria, `KERNEL_API_VERSION` em `apps/api/src/plugins/types.ts` (hoje `1.1.0`), independente da versão do app. O plugin declara a faixa aceita em `kernelApi`, sempre no formato `^MAJOR.MINOR.PATCH`.

- O kernel instala o plugin se o **major** for o mesmo e o kernel for **igual ou mais novo** que o pedido. Exemplo: kernel `1.1.0` aceita `^1.0.0` e `^1.1.0`, recusa `^1.2.0` e `^2.0.0`.
- **Patch**: correção sem mudar o contrato.
- **Minor**: só adição compatível (novo campo em `ctx`, novo slot, novo evento, campo opcional no manifesto). Plugin antigo continua funcionando.
- **Major**: qualquer quebra (remover ou mudar assinatura em `ctx`, mudar payload de evento do core, tornar obrigatório um campo do manifesto, mudar o formato do pacote). Plugins precisam de nova versão; anote no CHANGELOG do app.
- Mudou o contrato? Atualize `KERNEL_API_VERSION`, o comentário de versão em `packages/plugin-sdk/src/index.ts`, o `kernelApi` do template da CLI e o do plugin de referência, juntos.

Eventos do core que plugins assinam (`team.member_added` etc.) fazem parte do contrato: o payload só ganha campos em minor.
