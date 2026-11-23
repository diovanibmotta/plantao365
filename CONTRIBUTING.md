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
