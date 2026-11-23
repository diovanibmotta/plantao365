# Plantão360

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

> Em desenvolvimento: edição e publicação de escalas, trocas de plantão e recálculo por feriado tardio. O plano completo está em [`.ai/specs/plantao360`](.ai/specs/plantao360).

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
  shared/         regras de domínio compartilhadas (@plantao360/shared)
.ai/specs/        PRD e plano de tarefas
```

## Começando

Pré-requisitos: Node >= 22, npm >= 10 e um PostgreSQL acessível.

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL e MANAGER_EMAILS
npm run migrate -w @plantao360/api -- up
npm run dev                 # API em :3000 e web em :5173
```

Em desenvolvimento, `OIDC_MOCK=true` habilita um login simulado: informe um e-mail pré-cadastrado (os de `MANAGER_EMAILS` são criados como gestores na subida da API).

### Variáveis de ambiente

Veja [`.env.example`](.env.example). Em produção `OIDC_MOCK` é proibido e `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e `OIDC_REDIRECT_URI` são obrigatórios. SMTP é opcional; sem ele os e-mails não são enviados.

### Migrações

```bash
npm run migrate -w @plantao360/api -- status
npm run migrate -w @plantao360/api -- up
npm run migrate -w @plantao360/api -- down 1     # reverte N migrações (ou "all")
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

Os testes de API criam bancos temporários e exigem um usuário PostgreSQL com permissão de criar bancos:

```bash
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm test
```

## Releases

Versionamento automático com [semantic-release](https://semantic-release.gitbook.io) e [Gitmoji](https://gitmoji.dev) a cada push em `main`: tag `vX.Y.Z`, `CHANGELOG.md` e GitHub Release. Veja as regras de commit em [CONTRIBUTING.md](CONTRIBUTING.md).

## Contribuindo

Leia o [CONTRIBUTING.md](CONTRIBUTING.md).
