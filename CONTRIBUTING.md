# Contribuindo

## Fluxo

1. Todo o trabalho entra na branch `main`.
2. Antes de abrir PR ou fazer push, rode:
   ```bash
   npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
   ```
3. Mantenha mudanças pequenas e com testes. Código de domínio fica em `packages/shared` e deve continuar puro e determinístico (sem `Date.now`, `Math.random`).
4. Mudanças de banco: nova migração numerada em `apps/api/migrations` com `up` e `down`; nunca edite uma migração já aplicada.
5. Ações do gestor que alteram dados devem gravar auditoria (`recordAudit`) na mesma transação.

## E2E de navegador (Playwright)

O job `e2e` do CI sobe Postgres e a API com o build do front, instala o plugin de referência [emergency-contacts](https://github.com/plantao365/plugin-emergency-contacts) (commit fixado em `e2e/env.ts`) assinado, habilita com a master key e compara listagem, formulário e slot do perfil (claro/escuro, desktop/mobile) com os snapshots em `e2e/snapshots`. Também compara os estilos computados do plugin com os de telas nativas.

Para rodar na máquina, com um Postgres local (o banco `plantao365_e2e` é apagado e recriado):

```bash
npm run build && npx playwright install chromium && npm run test:e2e
```

`E2E_DATABASE_URL` troca o servidor (padrão `postgres://postgres:postgres@localhost:5432/postgres`). Os snapshots são do Linux: em outro sistema as fotos não são comparáveis. Para regerá-los depois de uma mudança visual intencional (revise as imagens no diff):

```bash
docker run -d --name p365-e2e-db -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
docker run --rm -v "$PWD:/src" --add-host=host.docker.internal:host-gateway -e E2E_DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5433/postgres mcr.microsoft.com/playwright:v1.65.1-noble sh /src/e2e/update-snapshots.sh
docker rm -f p365-e2e-db
```

Ao atualizar o `@playwright/test`, troque a tag da imagem aqui e no workflow.

## Commits

Cada commit segue **Gitmoji + Conventional Commits**:

```
<gitmoji> tipo(escopo): descrição curta no imperativo
```

- O gitmoji vem **primeiro** na linha de assunto e define a versão publicada.
- Assunto com no máximo 100 caracteres.
- `tipo`: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`.
- `escopo`: `api`, `web`, `shared`, `db`, `ci`, etc.

Exemplos:

```
✨ feat(api): gerar rascunho de escala por período
🐛 fix(web): corrige filtro de ano na tela de saldo
📝 docs: atualiza instruções de migração
```

### Efeito no versionamento

| Gitmoji                                   | Versão      |
| ----------------------------------------- | ----------- |
| 💥 `:boom:` (breaking change)             | major       |
| ✨ `:sparkles:` (funcionalidade)          | minor       |
| 🐛 `:bug:`, 🚑️ `:ambulance:`, 🔒️ `:lock:` | patch       |
| demais (📝 ♻️ ✅ 🔧 …)                    | sem release |

A cada push em `main`, o workflow [Release](.github/workflows/release.yml) valida (formatação, lint, tipos, testes, build) e roda o semantic-release, que cria a tag, atualiza `CHANGELOG.md` e publica o GitHub Release. O commit de release (`🔖 chore(release): …`) leva `[skip ci]`; não o edite à mão.

## Ambiente local

Veja o [README](README.md). Nunca commite `.env` ou credenciais.
