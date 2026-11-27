# @diovanibmotta/plantao365-plugin-sdk

Contrato do kernel para plugins do Plantão365 (`definePlugin`, `PluginContext`), lint de estilo, formato do pacote e a CLI `plantao-plugin`.

## CLI

```sh
npx plantao-plugin create contacts            # projeto novo em ./contacts
cd contacts && npm install
npx plantao-plugin build                      # server (esbuild) + web (Vite + MF) + lint de estilo
npx plantao-plugin pack                       # contacts-0.1.0.p365
npx plantao-plugin keygen --out ~/.plantao365 # uma vez: chave privada + pública
npx plantao-plugin sign contacts-0.1.0.p365 --key ~/.plantao365/plugin-signing.pem
npx plantao-plugin install contacts-0.1.0.p365 --url https://plantao.exemplo --token "$PLANTAO365_PLUGIN_TOKEN"
```

- `build` grava `dist/plantao365.plugin.json` com `styleCheck: "passed"` só se o CSS gerado passar no lint (seletor sob `.plg-<id>`, só tokens semânticos). Sem isso o kernel recusa o install.
- `install` usa `Authorization: Bearer`; o token vem de `--token` ou da env `PLANTAO365_PLUGIN_TOKEN`. Depois do install, habilite e configure em **Gestão › Plugins** (`/plugins`).

## Projeto do plugin

| Arquivo                  | Papel                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| `plantao365.plugin.json` | Manifesto: `id`, `name`, `version`, `kernelApi`, `settingsSchema`…    |
| `server/index.ts`        | `definePlugin({ setup(ctx) { … } })`; rotas em `/api/extensions/<id>` |
| `web/index.tsx`          | `definePluginWeb({ routes, nav, slots })`; telas em `/ext/<id>`       |
| `web/vite.config.ts`     | Remote Module Federation `plugin_<id>`, expõe `./web`                 |
| `migrations/*.sql`       | Pares `NNNN_nome.up.sql`/`.down.sql`, no schema `plugin_<id>`         |

`settingsSchema` é um subconjunto de JSON Schema (objeto plano com campos `string`, `number`, `integer` ou `boolean`, `title`, `description`, `enum`, `default`, `minimum`, `maximum`, `maxLength`, `format: email|uri` e `required`). A tela `/plugins/<id>` gera o formulário a partir dele e a API valida o que é salvo.

## Servidor (variáveis da API)

- `PLUGIN_PUBLIC_KEYS`: chaves públicas Ed25519 (saída do `keygen`), separadas por vírgula. Vazio desativa o install.
- `PLUGIN_INSTALL_TOKEN`: token aceito pela CLI (mínimo 32 caracteres). Vazio: só a master key instala.
- `PLUGINS_DIR`: cache dos pacotes extraídos (o original fica no banco). Vazio: diretório temporário do SO.
- Proxy na frente da API: encaminhe `/plugins-assets/` e aceite corpo de até 16 MB no install (o nginx e o Ingress do repositório já fazem isso).
- Com várias réplicas, install/enable/disable/configuração feitos em uma chegam às outras por `NOTIFY plugins_changed`; as migrações do plugin rodam uma vez, sob advisory lock.
