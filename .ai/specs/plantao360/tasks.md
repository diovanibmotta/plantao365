# Plano de implementação: Plantão360 — gestão de escala de plantão

## Visão geral

Monorepo TypeScript (`apps/api` Hono, `apps/web` React, `packages/shared` domínio puro). Ordem: fundação e regras de turno puras, depois autenticação, depois módulos de dados (feriados, exceções), o motor de rodízio como função pura testável, a escala (gerar, editar, publicar), trocas, saldo e notificações. Auditoria vem cedo porque as mutações dependem dela. Requisitos em `prd.md` (mesma pasta); referências `_Requisitos: X.Y_` apontam requisito e critério de aceite; `RNF-N` aponta os requisitos não-funcionais numerados na seção 7.

## Tasks

- [x] 1. Fundação
  - [x] 1.1 Criar monorepo (npm workspaces): `apps/api` (Hono), `apps/web` (React + Vite), `packages/shared`; TypeScript, ESLint, Prettier, Vitest.
    - Scripts raiz `dev`, `build`, `lint`, `test` funcionando.
    - _Depende de: (nenhuma)_
    - _Requisitos: RNF-8_
  - [x] 1.2 Configuração por ambiente (schema validado de variáveis, incluindo e-mails dos gestores iniciais, OIDC e SMTP), conexão PostgreSQL e ferramenta de migração.
    - Migração vazia aplica e reverte; instruções para PostgreSQL local sem Docker no README.
    - _Depende de: 1.1_
    - _Requisitos: RNF-1_
  - [x] 1.3 Migração inicial: `users` (id, oid Entra opcional, nome, e-mail único, telefone, papel, ativo, participa_rodizio, lembretes ligados) e base de `audit_log`.
    - _Depende de: 1.2_
    - _Requisitos: 2.1, 3.1, 3.5, 3.6, 13.1_
  - [x] 1.4 Domínio de turnos em `packages/shared`: tipo do dia (útil, fim de semana, feriado, férias coletivas), início/fim do turno, horas (14, 24, 0), fuso America/Sao_Paulo via biblioteca com tzdata, data e mês de atribuição (data de início).
    - Testes com datas fixas, incluindo virada de mês/ano e feriado em fim de semana.
    - _Depende de: 1.1_
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, RNF-4_
  - [x] 1.5 Checkpoint — fundação
    - `npm run lint`, `npm run test`, `npm run build` e migrações aplicadas em banco limpo.
    - _Depende de: 1.3, 1.4, 1.6_
  - [x] 1.6 Logs estruturados e endpoint `/health` na API.
    - _Depende de: 1.1_
    - _Requisitos: RNF-7_

- [x] 2. Autenticação e autorização
  - [x] 2.1 API: login OIDC Entra ID (code + PKCE), callback, sessão em cookie seguro, logout; só e-mail pré-cadastrado e ativo entra, vínculo do oid no 1º acesso; criação dos gestores iniciais (variável de ambiente) na inicialização; mock OIDC para desenvolvimento.
    - _Depende de: 1.3_
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.6_
  - [x] 2.2 API: middleware de autenticação e autorização por papel (gestor/membro), proteção CSRF.
    - _Depende de: 2.1_
    - _Requisitos: 1.5, RNF-1_
  - [x] 2.3 Web: shell React (rotas, layout, cliente de API, guarda de rota, tela de login, menu por papel).
    - _Depende de: 1.1, 2.1_
    - _Requisitos: 1.1, 1.3_

- [x] 3. Perfil e membros
  - [x] 3.1 API: `GET/PATCH /me` (telefone, lembretes), recusa de campos protegidos.
    - _Depende de: 2.2_
    - _Requisitos: 2.1, 2.2, 2.3_
  - [x] 3.2 API (gestor): listar, pré-cadastrar membro por e-mail (recusa duplicidade), alterar papel e "participa do rodízio" (padrão sim para membro, não para gestor), ativar/desativar, impedir remoção do último gestor.
    - A desativação com plantões futuros publicados é completada na 6.7.
    - _Depende de: 2.2_
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 3.3 Web: tela de perfil e tela de gestão de membros (pré-cadastro, papel, participa do rodízio, ativar/desativar).
    - _Depende de: 2.3, 3.1, 3.2_
    - _Requisitos: 2.1, 2.2, 3.1, 3.5, 3.6_

- [x] 4. Feriados
  - [x] 4.1 Migração e API de feriados (CRUD pelo gestor, leitura por todos), unicidade data+abrangência, seed de nacionais 2026 e 2027, aviso de impacto em escala publicada (sem recálculo automático), auditoria.
    - _Depende de: 2.2, 10.1_
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 4.2 Web: gestão de feriados (lista, criar, editar, remover) para o gestor, com aviso de impacto e ação de recálculo.
    - _Depende de: 2.3, 4.1_
    - _Requisitos: 4.1, 4.4, 4.6_
  - [x] 4.3 API (gestor): recalcular tipo e horas de plantões publicados afetados por feriado criado, alterado ou removido; auditoria; dispara evento de alteração tratado em 9.2.
    - _Depende de: 4.1, 6.4, 9.2_
    - _Requisitos: 4.4, 4.6, 12.2_

- [x] 5. Exceções e preferências
  - [x] 5.1 Migração e API de exceções (membro: próprias; gestor: qualquer membro e férias coletivas), validação de período, aviso de conflito com escala publicada, auditoria.
    - _Depende de: 2.2, 10.1_
    - _Requisitos: 5.1, 5.2, 5.3, 5.5, 5.6_
  - [x] 5.2 API de preferências do membro (dias da semana a evitar, máximo de consecutivos).
    - _Depende de: 5.1_
    - _Requisitos: 5.4_
  - [x] 5.3 Web: telas do membro para exceções e preferências; gestor cadastra férias coletivas e exceções de membros.
    - _Depende de: 2.3, 5.2_
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6. Escala
  - [x] 6.1 Migração e API de leitura de escalas e plantões (escala: período, estado rascunho/publicada; plantão: data, tipo, horas, responsável, `responsavel_original`, `horas_original`); membros só leem publicadas.
    - _Depende de: 2.2, 1.4_
    - _Requisitos: 8.6, 8.7, 9.1, 9.2, 9.3_
  - [x] 6.2 Motor de rodízio em `packages/shared` (função pura e determinística): só usuários ativos que participam do rodízio; exceções e férias coletivas como regra rígida; equilíbrio de horas realizadas e de fins de semana/feriados normalizado pela disponibilidade; preferências brandas; dias sem elegível sinalizados.
    - Testes com datas e membros fixos; mesmo input gera mesmo output; desempenho para 3 meses e 20 membros.
    - _Depende de: 1.4, 5.2_
    - _Requisitos: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, RNF-5_
  - [x] 6.3 API (gestor): gerar rascunho para um período livre usando feriados, exceções, preferências e histórico de horas realizadas (8.1); recusa se o período se sobrepõe a rascunho existente.
    - _Depende de: 6.1, 6.2, 4.1, 8.1_
    - _Requisitos: 7.1, 7.3, 7.8_
  - [x] 6.4 API (gestor): editar plantão, validar conflitos, publicar (exige confirmação se há dias sem responsável; recusa sobreposição com escala publicada; grava responsável e horas originais), alterar escala publicada com motivo obrigatório e registro; auditoria.
    - _Depende de: 6.3, 10.1_
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7_
  - [x] 6.5 Web (gestor): gerar, revisar em calendário, editar plantões com avisos de conflito e publicar; modo de edição de escala publicada com motivo obrigatório e aviso de notificação.
    - _Depende de: 2.3, 6.4_
    - _Requisitos: 7.1, 7.6, 8.1, 8.2, 8.3, 8.4_
  - [x] 6.6 Web: "Minha escala" e calendário da equipe com tipo do dia, horas, filtros e destaque do próprio plantão.
    - _Depende de: 2.3, 6.1_
    - _Requisitos: 9.1, 9.2, 9.3, 9.4_
  - [x] 6.7 Desativação de membro com plantões futuros publicados: API lista os plantões e bloqueia a desativação até a reatribuição; ajuste na tela de membros.
    - _Depende de: 3.3, 6.4_
    - _Requisitos: 3.2_

- [x] 7. Trocas de plantão
  - [x] 7.1 Migração e API de trocas: solicitar (permuta ou cessão), aceitar/recusar, cancelar, aprovar/rejeitar pelo gestor, aplicar na escala; recusa por exceção do colega com mensagem genérica; auditoria.
    - _Depende de: 6.4_
    - _Requisitos: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [x] 7.2 Web: solicitar troca a partir de "Minha escala", caixa de pedidos do colega, fila de aprovação do gestor.
    - _Depende de: 6.6, 7.1_
    - _Requisitos: 10.1, 10.2, 10.3, 10.4_

- [x] 8. Saldo de horas
  - [x] 8.1 Migração e API de saldo: previsto (horas originais gravadas na publicação), realizado (escala vigente de plantões encerrados + ajustes), por mês da data de início e acumulado do ano; ajustes do gestor; visão da equipe só para gestor; auditoria.
    - _Depende de: 6.1, 10.1_
    - _Requisitos: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [x] 8.2 Web: saldo do membro (mensal, acumulado, detalhe por plantão) e comparativo e ajustes do gestor.
    - _Depende de: 2.3, 8.1_
    - _Requisitos: 11.3, 11.4, 11.5_

- [x] 9. Notificações por e-mail
  - [x] 9.1 Serviço de e-mail: SMTP configurável, templates pt-BR, tabela de outbox com retry limitado e registro de falha; servidor SMTP de teste em memória para os testes.
    - _Depende de: 1.3_
    - _Requisitos: 12.5, 12.7, RNF-8_
  - [x] 9.2 Eventos de escala: publicação e alteração de plantão publicado (inclui alteração por recálculo de feriado).
    - _Depende de: 9.1, 6.4_
    - _Requisitos: 12.1, 12.2_
  - [x] 9.3 Eventos de troca: solicitação, aceite, recusa, aprovação e rejeição; aviso ao gestor quando o colega aceita.
    - _Depende de: 9.1, 7.1_
    - _Requisitos: 12.3, 12.8_
  - [x] 9.4 Job de lembrete 24h antes do plantão, idempotente, respeitando a opção de lembrete do perfil.
    - _Depende de: 9.1, 6.1_
    - _Requisitos: 12.4, 12.6_

- [x] 10. Auditoria
  - [x] 10.1 Serviço de auditoria (ator, ação, entidade, antes/depois, data/hora), tabela só de inserção, API de consulta com filtros restrita ao gestor.
    - _Depende de: 1.3_
    - _Requisitos: 13.1, 13.2, 13.3, 13.4_
  - [x] 10.2 Web (gestor): tela de auditoria com filtros.
    - _Depende de: 10.1, 2.3_
    - _Requisitos: 13.2, 13.4_

- [x] 11. Entrega
  - [x] 11.1 Checkpoint — backend completo
    - Testes de API de todos os módulos, `npm run lint`, `npm run test`, `npm run build`.
    - _Depende de: 3.2, 4.3, 5.2, 6.4, 6.7, 7.1, 8.1, 9.2, 9.3, 9.4_
  - [x] 11.2 Testes E2E do fluxo principal: login mock, gerar, revisar, publicar, membro vê escala, troca aprovada, saldo atualizado, e-mail capturado no SMTP de teste.
    - _Depende de: 11.1, 3.3, 4.2, 5.3, 6.5, 6.6, 7.2, 8.2_
    - _Requisitos: 1.2, 7.1, 8.2, 9.1, 10.3, 11.4, 12.1_
  - [x] 11.3 Dockerfile (api e web), README de execução e configuração (variáveis, Entra ID, SMTP, gestores iniciais), pipeline de CI com lint, testes e build.
    - _Depende de: 11.1_
    - _Requisitos: RNF-7_
  - [x] 11.4 Checkpoint — final
    - E2E verde, CI verde, checklist dos requisitos 1 a 13 conferido contra o PRD.
    - _Depende de: 11.2, 11.3, 10.2_

## Notas

- Sem Docker local: PostgreSQL de desenvolvimento precisa de instalação nativa ou instância remota (Q1, Q6 do PRD).
- Auditoria (10.1) entra antes dos módulos que mutam dados, por isso 4.1, 5.1, 6.4 e 8.1 dependem dela.
- O motor de rodízio (6.2) é função pura sem acesso a banco, para ser testado com dados fixos; o histórico de horas realizadas vem de 8.1 via 6.3. Pesos de equilíbrio dependem de Q5.
- Decisões da revisão: admissão por pré-cadastro (2.1, 3.2), flag "participa do rodízio" (1.3, 6.2), mês de início para horas (1.4, 8.1), recálculo de feriado por confirmação do gestor (4.3). Sugestões aceitas: snapshot do previsto no plantão (6.1, 6.4), reatribuição antes de desativar (6.7), e-mail ao gestor em troca aceita (9.3), edição de publicada na UI (6.5), mensagem genérica na recusa de troca (7.1), período livre sem sobreposição de rascunhos (6.3).
- Sem importador da planilha (Q2) e sem importação automática de feriados (Q3) nesta rodada; Q4 define o conceito de realizado (default adotado).
- Waves são auxílio de planejamento (paralelismo teórico), não imposição. Caminho crítico (15 waves): 1.1, 1.2, 1.3, 2.1, 2.2, 5.1, 5.2, 6.2, 6.3, 6.4, 9.2, 4.3, 11.1, 11.2, 11.4.

## Grafo de dependência de tasks

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.5", "2.1", "9.1", "10.1"] },
    { "id": 4, "tasks": ["2.2", "2.3"] },
    { "id": 5, "tasks": ["3.1", "3.2", "4.1", "5.1", "6.1", "10.2"] },
    { "id": 6, "tasks": ["3.3", "4.2", "5.2", "6.6", "8.1", "9.4"] },
    { "id": 7, "tasks": ["5.3", "6.2", "8.2"] },
    { "id": 8, "tasks": ["6.3"] },
    { "id": 9, "tasks": ["6.4"] },
    { "id": 10, "tasks": ["6.5", "6.7", "7.1", "9.2"] },
    { "id": 11, "tasks": ["4.3", "7.2", "9.3"] },
    { "id": 12, "tasks": ["11.1"] },
    { "id": 13, "tasks": ["11.2", "11.3"] },
    { "id": 14, "tasks": ["11.4"] }
  ]
}
```
