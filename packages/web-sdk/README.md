# @diovanibmotta/plantao365-web-sdk

Design system compartilhado e SDK do front para plugins do Plantão365. O app e os plugins usam os mesmos tokens e componentes, então um plugin instalado parece nativo.

## O que tem aqui

- `tokens.css`: tokens em duas camadas.
  - **Primários**: escala crua (`--color-gray-*`, `--color-blue-*`, `--space-*`, `--radius-*`, `--font-*`, `--ease-*`). Não use direto.
  - **Semânticos**: papel na interface, com claro/escuro (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--danger`, `--success`, `--warning`, `--ring`, `--radius`, `--space`, `--font`…). Componentes e plugins usam só estes.
- Componentes "dumb" (só props → visual, sem estado de app nem HTTP): `PageHeader`, `FilterBar` (+ `normalizeSearch`), `EmptyState`, `FormPage`/`FormSection`/`FormActions`, `Breadcrumb`, `ConfirmDialog`, `InfoDialog`, `Pagination` (+ `usePagination`) e `PluginPage`. Tabela: classes `ui-table-wrap` / `ui-table`.
- Serviços do host (registrados pelo app com `registerWebSdk`): `api`, `toast`, `useActiveTeam`, `useRole`.

O host carrega `tokens.css`, `ui.css` (estilos dos componentes) e os estilos globais (botões `.btn`, campos de formulário). O plugin não importa nem redefine nada disso.

## Checklist visual do plugin

- [ ] Telas montadas com os componentes acima, no padrão de telas do app: listagem com `PageHeader` + `FilterBar` + `ui-table` + "N de M registros" + `EmptyState`; formulário em rota própria com `FormPage`, `FormActions` e Excluir só com `ConfirmDialog`.
- [ ] Tela sem formulário começa por `PluginPage` (título, descrição, breadcrumb).
- [ ] Feedback de mutação pelo toast do `api` (`successMessage`); sem mensagem inline de sucesso.
- [ ] CSS escopado: todo seletor de topo começa por `.plg-<id>`, classe que o host põe no container das rotas e de cada slot do plugin (regras aninhadas herdam o escopo). Nada de `body`, `:root`, tag solta nem classe do host (`.btn`, `.ui-table`…) fora desse escopo.
- [ ] Cores só por `var(--…)` semântico; sem hex, `rgb()`, `oklch()` etc. Sem `!important`.
- [ ] Sem `@import`, `@font-face` ou `url()` remoto: a fonte é a do host.
- [ ] Propriedades customizadas próprias com prefixo `--plg-`.
- [ ] Ícone de menu como dados `d` de paths 24x24 em traço, sem cor própria.
- [ ] Slots preenchem só o conteúdo; a moldura vem do host.
- [ ] E-mail só por `ctx.enqueueEmail` (texto; o layout base é do core).
- [ ] Conferido nos temas claro e escuro, em desktop e mobile.

A CLI roda o lint de estilo (`checkPluginStyles`, do `plugin-sdk`) no build/pack e grava `styleCheck: "passed"` no manifesto. O kernel recusa no install pacote com front sem esse campo e confere o CSS de novo.
