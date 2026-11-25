# CLAUDE.md

Convenções do Plantão365 para agentes e pessoas. Visão geral e setup no [README](README.md); fluxo de contribuição no [CONTRIBUTING](CONTRIBUTING.md).

## Monorepo

- npm workspaces: `apps/api` (Hono), `apps/web` (React 19 + Vite + React Router), `packages/shared` (domínio puro).
- Node >= 22, ESM (`"type": "module"`). Na API, imports relativos levam extensão `.js`.
- Em worktree/clone novo, rode `npm ci` e `npm run build -w @diovanibmotta/plantao365-shared` antes dos testes; web e API importam o `dist` do shared.

## Idioma

- **Código em inglês**: identificadores, nomes de arquivo, rotas do front, endpoints da API, chaves JSON, códigos de erro (`{ error: 'unauthenticated' }`), nomes de tabela/coluna.
- **Texto para o usuário em pt-BR**: labels, mensagens de erro exibidas, e-mails, títulos de página.
- Comentários, nomes de teste (`describe`/`it`), commits e docs em pt-BR.

## Rotas e endpoints

- Sempre em inglês, kebab-case, substantivos no plural para coleções.
- **Front** (`apps/web/src/App.tsx`, menu em `apps/web/src/layout/nav.ts`): `/my-schedule`, `/schedule`, `/swaps`, `/balance`, `/profile`, e de gestor `/members`, `/vacations`, `/schedule-admin`, `/holidays`, `/audit`.
  - Ao renomear uma rota, adicione a antiga em `LEGACY_PATHS` (App.tsx) para não quebrar links de e-mails já enviados e favoritos.
  - Links do front gerados pela API (e-mails em `apps/api/src/notifications`) usam os mesmos paths; mude os dois juntos.
- **API**: tudo sob `/api` (`app.route('/api', ...)` em `apps/api/src/app.ts`), exceto `/auth/*` e `/health`. Ex.: `/api/schedules/:id/publish`, `/api/me/preferences`, `/api/users/:id/balance`. Recursos do usuário logado ficam em `/api/me/...`.
- Proxy de `/api` e `/auth` para a API: `apps/web/vite.config.ts` (dev) e `apps/web/nginx.conf.template` (prod).

## API (`apps/api/src`)

- Um módulo por domínio (`audit`, `balance`, `holidays`, `schedules`, `swaps`, `users`, ...) com `router.ts` (HTTP, validação zod), `service.ts` (regras + SQL), `types.ts` e `index.ts` (exports públicos). Quando o módulo tem `index.ts`, os outros importam só dele.
- Routers são fábricas `createXRouter(deps)` com dependências injetadas (db, hooks de evento) — facilita teste.
- Autorização: `requireAuth()` / `requireRole('manager')` de `auth/`. Mutação exige header CSRF (`X-Requested-With`).
- SQL com `postgres.js` (template tag), sem ORM. Ações do gestor que alteram dados gravam `recordAudit` na mesma transação.
- Efeitos colaterais (e-mail) via hooks `createOn...` e fila `email_outbox`; nunca envie e-mail direto no request.
- Migrações: novo par numerado `NNNN_nome.up.sql` / `.down.sql` em `apps/api/migrations`. Nunca edite migração aplicada.
- **Regra core, impacto em escala publicada**: toda mutação que pode invalidar plantões já publicados (exceção/férias de membro, férias coletivas, feriado, horários e exceções de horário) chama `runScheduleImpact` (`schedule-impact/`) dentro da transação, via dependência `scheduleImpactNotifier`. Ela devolve `scheduleImpact` na resposta (o interceptor do web exibe o toast) e publica `schedule.impact` (e-mail aos gestores da equipe). Ponto de entrada novo que afete a escala deve usar o mesmo caminho (novo `source` em `schedule-impact/types.ts`).
- Logs com pino (`logger`); não logue e-mail completo (use `maskEmail`).

## Web (`apps/web/src`)

- Uma pasta por funcionalidade (`balance/`, `schedule/`, `holidays/`, ...) com componentes, `types.ts` e CSS próprio; páginas roteáveis em `pages/`.
- Chamadas HTTP sempre por `api/client.ts` (trata CSRF, 401/403 e erros de rede).
- Feedback de mutação (POST/PUT/PATCH/DELETE) é toast do interceptor de `api/client.ts`: texto de sucesso via `successMessage` (opções do `api.put/post/delete`), erro já tratado pelo interceptor. Não crie mensagem inline de sucesso/erro nem duplique o toast no `catch` (`catch { /* interceptor */ }`); use `silentError`/`errorMessage` só quando a tela precisar tratar o erro. Mensagem inline fica para erro de carregamento (GET) e validação de formulário no cliente.
- **Padrão de telas** (componentes em `apps/web/src/ui/`; referência completa: aba Escala em `apps/web/src/schedule-admin/` — `ShiftExceptionsList`/`ShiftExceptionForm`, `WorkHoursList`/`WorkHoursForm`, `SchedulesList`, `paths.ts`). Vale para toda tela de cadastro, nova ou migrada.
  - **Listagem** (somente leitura): `PageHeader` (título, descrição de uma linha, CTA único "Novo …" à direita — é o único botão de destaque), `FilterBar` (busca textual sem acento/caixa via `normalizeSearch`, mais os filtros que fizerem sentido; "Limpar filtros" só com filtro ativo), tabela `ui-table` com "Editar" em cada linha (a linha inteira também é clicável), contagem "N de M registros" e paginação no rodapé (`Pagination`/`usePagination` de `ui/Pagination.tsx`: tamanho da página 10/25/50/100, padrão 25, `<` `1 de X páginas` `>`; volta à página 1 ao mudar filtro) e `EmptyState` com o CTA quando não há registros (sem barra de filtro nesse caso). "Nenhum registro encontrado para os filtros aplicados." quando o filtro zera a lista. Sem botão de excluir na listagem.
  - **Formulário** (rota própria `/…/new` e `/…/:id`, nunca modal nem inline na listagem): `FormPage` com breadcrumb (`Crumb[]`), `FormSection`s com título e descrição curta, e barra fixa `FormActions`: Excluir à esquerda (só na edição, só se o registro puder ser excluído), Cancelar e Salvar à direita. Excluir abre `ConfirmDialog` que diz o efeito. Salvar/excluir/cancelar voltam à listagem.
  - **Validação**: erros de regra visíveis no próprio formulário (`role="alert"`) e, quando a regra é bloqueante, `saveDisabled` no `FormActions` (ex.: sobreposição de períodos). Regra de negócio também validada na API. Erro de carregamento (GET) é inline com "Voltar para a listagem"; rota inválida ou registro inexistente mostra mensagem, nunca tela em branco.
  - **Dados**: o formulário carrega o registro pela API (não depende de estado da listagem) e a listagem recarrega ao montar. Chave na rota estável (id; ou data/posição quando o registro não tem id) e unicidade verificada no cadastro. Filtro e busca rodam no cliente até a tela justificar paginação na API.
  - **Rotas e abas**: abas da página pai são controladas por `?tab=` (`tabPath()` em `paths.ts`); centralize os paths da funcionalidade em um `paths.ts`. Rota de formulário nova entra em `App.tsx` dentro do mesmo guard da listagem.
  - **Configuração única** (sem cadastro de itens) também segue o padrão: um registro por linha, "Editar" e formulário em rota própria; toda listagem tem `FilterBar`, mesmo curta.
  - **Testes**: cobrir listagem (busca, filtros, vazio), formulário (criar, editar, validação, excluir só após confirmação, registro inexistente) com `MemoryRouter`; ao migrar uma tela, os testes antigos dela são reescritos para o novo fluxo.
- Guardas de rota em `auth/guards.tsx` (`RequireAuth`, `RequireRole`).

## Domínio (`packages/shared`)

- TypeScript puro e determinístico: sem `Date.now`, `Math.random`, I/O. Datas/turnos no fuso `America/Sao_Paulo`.

## Testes

- Vitest, arquivo `*.test.ts(x)` ao lado do código. Web usa Testing Library (`// @vitest-environment jsdom`).
- Testes de API que usam banco pulam sem `TEST_DATABASE_URL`; o CI sobe Postgres e roda todos.
- Antes de PR: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build`.

## Git

- Commits Gitmoji + Conventional Commits (`✨ feat(web): ...`); o gitmoji define a versão (semantic-release). Detalhes no CONTRIBUTING.
- Não edite `CHANGELOG.md` nem commits `🔖 chore(release)` à mão.
- Nunca commite `.env` ou credenciais.
