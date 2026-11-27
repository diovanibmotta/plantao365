<p align="center"><img src="apps/web/public/favicon.svg" width="56" alt="Plantão365" /></p>

# Plantão365

Gestão de escala de plantão (sobreaviso) para equipes: rodízio automático com revisão do gestor, preferências e exceções dos membros, saldo de horas previsto x realizado e avisos por e-mail.

Este README é para quem desenvolve. Uso, implantação, configuração e SSO estão na **[wiki](https://github.com/diovanibmotta/plantao365/wiki)**:

- [Primeiro acesso](https://github.com/diovanibmotta/plantao365/wiki/Primeiro-Acesso) · [Guia do gestor](https://github.com/diovanibmotta/plantao365/wiki/Guia-do-Gestor) · [Guia do membro](https://github.com/diovanibmotta/plantao365/wiki/Guia-do-Membro)
- [Configuração (variáveis de ambiente)](https://github.com/diovanibmotta/plantao365/wiki/Configuracao) · [SSO Entra ID](https://github.com/diovanibmotta/plantao365/wiki/SSO-Entra-ID)
- [Implantação](https://github.com/diovanibmotta/plantao365/wiki/Implantacao): [Kubernetes](https://github.com/diovanibmotta/plantao365/wiki/Implantacao-Kubernetes), [imagem única](https://github.com/diovanibmotta/plantao365/wiki/Implantacao-Imagem-Unica), [Docker Compose](https://github.com/diovanibmotta/plantao365/wiki/Implantacao-Docker-Compose)
- [Solução de problemas](https://github.com/diovanibmotta/plantao365/wiki/Solucao-de-Problemas)
- [Plugins](https://github.com/diovanibmotta/plantao365/wiki/Plugins) (a partir da 2.0.0): [guia do autor](https://github.com/diovanibmotta/plantao365/wiki/Plugins-Guia-do-Autor), [contrato](https://github.com/diovanibmotta/plantao365/wiki/Plugins-Contrato), [operação](https://github.com/diovanibmotta/plantao365/wiki/Plugins-Operacao)

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
deploy/k8s/       manifests Kubernetes (Kustomize)
```

Convenções de código, rotas e padrão de telas: [CLAUDE.md](CLAUDE.md).

## Começando

Pré-requisitos: Node >= 22, npm >= 10 e um PostgreSQL acessível.

```bash
npm ci
cp .env.example .env        # ajuste DATABASE_URL e MANAGER_EMAILS
npm run migrate -w @diovanibmotta/plantao365-api -- up
npm run dev                 # API em :3000 e web em :5173
```

Sem SSO configurado, defina `MASTER_USERNAME`/`MASTER_PASSWORD` no `.env` e entre por "Acesso master" na tela de login. Demais variáveis em [`.env.example`](.env.example) e na [wiki](https://github.com/diovanibmotta/plantao365/wiki/Configuracao).

### Migrações

Novo par numerado `NNNN_nome.up.sql` / `.down.sql` em `apps/api/migrations`; nunca edite migração já aplicada. A API aplica as pendentes ao subir (com lock entre réplicas); `AUTO_MIGRATE=false` desliga.

```bash
npm run migrate -w @diovanibmotta/plantao365-api -- status
npm run migrate -w @diovanibmotta/plantao365-api -- up
npm run migrate -w @diovanibmotta/plantao365-api -- down 1     # reverte N migrações (ou "all")
```

## Scripts

| Comando                           | O que faz                         |
| --------------------------------- | --------------------------------- |
| `npm run dev`                     | API e web em modo desenvolvimento |
| `npm run build`                   | build de shared, api e web        |
| `npm run lint`                    | ESLint                            |
| `npm run format` / `format:check` | Prettier                          |
| `npm run typecheck`               | `tsc -b`                          |
| `npm test`                        | Vitest                            |

Antes de abrir PR: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build`.

Os testes de API que usam banco pulam sem `TEST_DATABASE_URL`; com ela, criam bancos temporários (o usuário precisa poder criar bancos):

```bash
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm test
```

## Releases

Versionamento automático com [semantic-release](https://semantic-release.gitbook.io) e [Gitmoji](https://gitmoji.dev) a cada push em `main`: tag `vX.Y.Z`, `CHANGELOG.md` e GitHub Release. Cada release publica:

- `@diovanibmotta/plantao365-shared` e `@diovanibmotta/plantao365-api` no GitHub Packages (npm);
- imagens `ghcr.io/diovanibmotta/plantao365-api` e `ghcr.io/diovanibmotta/plantao365` (API + front), tags `X.Y.Z`, `X.Y` e `latest`.

Regras de commit em [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

Distribuído sob a [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Quem rodar uma versão modificada como serviço de rede precisa disponibilizar o código-fonte dessa versão aos usuários.
