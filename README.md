<p align="center"><img src="apps/web/public/favicon.svg" width="56" alt="Plantão365" /></p>

# Plantão365

Gestão de escala de plantão (sobreaviso) para equipes: rodízio automático com revisão do gestor, preferências e exceções dos membros, saldo de horas previsto x realizado e avisos por e-mail.

## Funcionalidades

- Login corporativo via SSO Microsoft Entra ID (OIDC), com IdP simulado em desenvolvimento.
- Papéis **gestor** e **membro**; acesso apenas para e-mails pré-cadastrados.
- Calendário de feriados e férias coletivas cadastrados no sistema.
- Regras de turno: dia útil 14h (18h–08h); fim de semana e feriado 24h (08h–08h); férias coletivas 0h. Fuso `America/Sao_Paulo`.
- Exceções (férias, folga, outro) e preferências brandas (dias a evitar, máximo de plantões consecutivos).
- Geração automática do rodízio em rascunho, determinística e equilibrada pela disponibilidade de cada membro.
- Saldo de horas por mês e acumulado do ano, com detalhe por plantão e ajustes do gestor.
- Lembretes e avisos por e-mail (SMTP) com fila e retentativas.
- Trilha de auditoria imutável das ações do gestor.

## Stack

| Camada  | Tecnologia                                                            |
| ------- | --------------------------------------------------------------------- |
| API     | Node 22, [Hono](https://hono.dev), TypeScript, postgres.js, zod, pino |
| Web     | React 19, Vite, React Router                                          |
| Domínio | `packages/shared` (TypeScript puro: datas, turnos, motor de rodízio)  |
| Banco   | PostgreSQL com migrações SQL up/down                                  |
| Testes  | Vitest + Testing Library                                              |

## Estrutura (monorepo npm workspaces)

```
apps/
  api/            API Hono, migrações em apps/api/migrations
  web/            SPA React
packages/
  shared/         regras de domínio compartilhadas (@diovanibmotta/plantao365-shared)
```

## Começando

Pré-requisitos: Node >= 22, npm >= 10 e um PostgreSQL acessível.

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL e MANAGER_EMAILS
npm run migrate -w @diovanibmotta/plantao365-api -- up
npm run dev                 # API em :3000 e web em :5173
```

Em desenvolvimento, `OIDC_MOCK=true` habilita um login simulado: informe um e-mail pré-cadastrado (os de `MANAGER_EMAILS` são criados como gestores na subida da API).

### Variáveis de ambiente

Veja [`.env.example`](.env.example) e a seção [Configuração](#configuração).

### Migrações

```bash
npm run migrate -w @diovanibmotta/plantao365-api -- status
npm run migrate -w @diovanibmotta/plantao365-api -- up
npm run migrate -w @diovanibmotta/plantao365-api -- down 1     # reverte N migrações (ou "all")
```

## Docker

Imagens da API (`apps/api/Dockerfile`) e do web (`apps/web/Dockerfile`, nginx), ambas construídas a partir da raiz do repositório. O `docker-compose.yml` sobe PostgreSQL, API e web:

```bash
cp .env.example .env     # defina POSTGRES_PASSWORD, APP_BASE_URL, MANAGER_EMAILS e OIDC_*
docker compose build
docker compose run --rm api node dist/migrate.js up   # migrações (não rodam sozinhas)
docker compose up -d
```

A aplicação responde em `http://localhost:8080` (`WEB_PORT`). O nginx serve a SPA e repassa `/api` e `/auth` para a API (`API_UPSTREAM`, padrão `http://api:3000`). Healthchecks: API em `/health`, web em `/healthz`. Para atualizar, rode o `build` e as migrações novamente.

Em `NODE_ENV=production` o cookie de sessão é `Secure`: publique o web atrás de HTTPS (proxy reverso ou balanceador com TLS) e use `APP_BASE_URL` com `https://`. Se a senha do banco tiver caracteres especiais, aplique URL-encode, pois ela compõe a `DATABASE_URL` montada no compose.

> As imagens e o compose ainda não foram validados em um ambiente com Docker; o CI apenas as constrói.

## Configuração

| Variável                              | Obrigatória      | Padrão                  | Descrição                                                                     |
| ------------------------------------- | ---------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `NODE_ENV`                            | não              | `development`           | `development`, `test` ou `production`                                         |
| `PORT`                                | não              | `3000`                  | porta da API                                                                  |
| `LOG_LEVEL`                           | não              | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                  |
| `APP_BASE_URL`                        | não              | `http://localhost:5173` | URL pública do web (redirecionamentos e links dos e-mails)                    |
| `DATABASE_URL`                        | sim              | -                       | `postgres://usuario:senha@host:5432/banco`                                    |
| `MANAGER_EMAILS`                      | sim em produção¹ | vazio                   | gestores iniciais, e-mails separados por vírgula                              |
| `MASTER_USERNAME` / `MASTER_PASSWORD` | não¹             | vazio                   | master key: usuário e senha (12+ caracteres) do primeiro acesso               |
| `SESSION_TTL_SECONDS`                 | não              | `28800`                 | duração da sessão em segundos (mínimo 60)                                     |
| `COOKIE_SECURE`                       | não              | produção: `true`        | força o atributo Secure do cookie de sessão (use `true` em staging com HTTPS) |
| `OIDC_MOCK`                           | não              | `false`                 | login simulado; **proibido em produção**                                      |
| `OIDC_ISSUER`                         | sim em produção  | -                       | `https://login.microsoftonline.com/<tenant-id>/v2.0`                          |
| `OIDC_CLIENT_ID`                      | sim em produção  | -                       | ID do aplicativo (cliente) no Entra ID                                        |
| `OIDC_CLIENT_SECRET`                  | sim em produção  | -                       | segredo do cliente                                                            |
| `OIDC_REDIRECT_URI`                   | sim em produção  | -                       | `<URL pública>/auth/callback`                                                 |
| `SMTP_HOST`                           | não              | -                       | habilita o envio de e-mails                                                   |
| `SMTP_PORT`                           | não              | `587`                   | porta SMTP                                                                    |
| `SMTP_SECURE`                         | não              | `false`                 | `true` para TLS implícito (normalmente porta 465)                             |
| `SMTP_USER`                           | não              | -                       | usuário SMTP                                                                  |
| `SMTP_PASSWORD`                       | não              | -                       | senha SMTP                                                                    |
| `SMTP_FROM`                           | com `SMTP_HOST`  | -                       | remetente dos e-mails                                                         |

Somente no compose: `POSTGRES_USER`, `POSTGRES_PASSWORD` (obrigatória), `POSTGRES_DB` e `WEB_PORT`.

### Registrar o app no Entra ID

1. No portal Azure, abra **Microsoft Entra ID > Registros de aplicativo > Novo registro**.
2. Tipo de conta: apenas este diretório (locatário único).
3. Em **URI de redirecionamento**, plataforma **Web**, informe `https://<seu-dominio>/auth/callback` (o mesmo valor de `OIDC_REDIRECT_URI`). Para testes locais: `http://localhost:8080/auth/callback` (compose) ou `http://localhost:5173/auth/callback` (`npm run dev`).
4. Em **Certificados e segredos**, crie um segredo do cliente e use o valor em `OIDC_CLIENT_SECRET`.
5. Em **Visão geral**, copie o ID do aplicativo (`OIDC_CLIENT_ID`) e o ID do diretório (locatário) para montar `OIDC_ISSUER`.

Escopos solicitados: `openid`, `profile`, `email` e `User.Read` (Microsoft Graph). Só entra quem tem o e-mail pré-cadastrado no sistema.

`User.Read` é usado para baixar a foto do usuário (`/me/photos/96x96/$value`) a cada login; ela aparece no menu lateral e na escala. Em **Permissões de API**, confirme que **Microsoft Graph > User.Read (delegada)** está concedida (vem por padrão em novos registros). Sem a permissão ou sem foto no diretório, o sistema mostra as iniciais.

### SMTP e gestores iniciais

- Sem `SMTP_HOST` os e-mails são apenas registrados em log. Com ele, `SMTP_FROM` é obrigatório.
- A cada subida, a API cria como gestores os e-mails de `MANAGER_EMAILS` que ainda não existem (usuários já cadastrados não são alterados). Os demais usuários são cadastrados por um gestor.
- ¹ Em produção é preciso `MANAGER_EMAILS` **ou** a master key.

### Master key, convites e convidados

- **Master key**: com `MASTER_USERNAME` e `MASTER_PASSWORD` definidos, a tela de login ganha "Acesso master". O usuário master é gestor, fica fora do rodízio e não aparece na Equipe; suas ações são auditadas. A partir dele, cadastre os demais (convites) e configure o restante. Remover as variáveis desativa o acesso e encerra as sessões master. Após 5 falhas em 15 minutos o login master é bloqueado (429) até a janela esvaziar. Use senha forte e HTTPS.
- **Convite**: cadastrar um usuário em Equipe é o convite; ele entra via SSO com o papel atribuído e recebe um e-mail (fila `email_outbox`).
- **Convidado**: quem entra via SSO sem convite vira usuário `guest` e só lê o calendário de escala publicada e feriados; qualquer outra rota ou alteração responde 403. Um gestor pode convidá-lo depois (promove o mesmo usuário) ou rebaixar alguém para convidado na Equipe.

> Nunca use `OIDC_MOCK=true` fora de desenvolvimento: qualquer pessoa entraria com o e-mail que quisesse. A API se recusa a subir em produção com essa opção.

## Scripts

| Comando                           | O que faz                         |
| --------------------------------- | --------------------------------- |
| `npm run dev`                     | API e web em modo desenvolvimento |
| `npm run build`                   | build de shared, api e web        |
| `npm run lint`                    | ESLint                            |
| `npm run format` / `format:check` | Prettier                          |
| `npm run typecheck`               | `tsc -b`                          |
| `npm test`                        | Vitest                            |

Os testes de API criam bancos temporários e exigem um usuário PostgreSQL com permissão de criar bancos:

```bash
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm test
```

## Releases

Versionamento automático com [semantic-release](https://semantic-release.gitbook.io) e [Gitmoji](https://gitmoji.dev) a cada push em `main`: tag `vX.Y.Z`, `CHANGELOG.md` e GitHub Release. Veja as regras de commit em [CONTRIBUTING.md](CONTRIBUTING.md).

### Artefatos publicados

A cada release o workflow publica:

- **Pacote TypeScript** `@diovanibmotta/plantao365-shared` (regras de domínio com tipos `.d.ts`) no GitHub Packages (npm).
- **Pacote Node da API** `@diovanibmotta/plantao365-api` (`dist/` compilado + `migrations/`) no GitHub Packages (npm).
- **Imagem da API** `ghcr.io/diovanibmotta/plantao365-api`, com as tags `X.Y.Z`, `X.Y` e `latest`.

```bash
# .npmrc: @diovanibmotta:registry=https://npm.pkg.github.com
npm install @diovanibmotta/plantao365-shared @diovanibmotta/plantao365-api
node node_modules/@diovanibmotta/plantao365-api/dist/index.js   # sobe a API (variáveis em .env.example)
docker pull ghcr.io/diovanibmotta/plantao365-api:latest
```

## Contribuindo

Leia o [CONTRIBUTING.md](CONTRIBUTING.md).
