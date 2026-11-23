---
feature_name: Plantão360 — gestão de escala de plantão
slug: plantao360
status: rascunho
created_at: 2026-11-23
source_context:
  - Conversa com o usuário (ideia trazida diretamente) + planilha "Escala Sobreaviso SRE Central" (abas 2026/2025/2024/2023, Equipe SRE, post-mortem)
open_questions_count: 7
---

# PRD: Plantão360 — gestão de escala de plantão

## 1. Problema e motivação

A escala de sobreaviso da equipe SRE Central vive numa planilha Excel (uma aba por ano). Cada linha é um dia, com período (18h-08h em dia útil, 08h-08h em fim de semana/feriado), quantidade de horas (14 ou 24) e responsável. Feriados e férias são anotados à mão em colunas laterais. O rodízio é montado manualmente.

Consequências: equilíbrio de carga entre pessoas é conferido a olho; exceções e férias são fáceis de esquecer; o membro não tem visão própria da escala nem do saldo de horas; avisos de plantão dependem de lembrança ou mensagem manual.

Plantão360 substitui a planilha por um sistema web: gestor gera o rodízio automaticamente, revisa e publica; membros entram com SSO corporativo, veem suas escalas, cadastram exceções e preferências, acompanham saldo de horas e recebem e-mails sobre seus plantões.

## 2. Objetivos

1. Login exclusivo via SSO Entra ID, com dois papéis: gestor e membro.
2. Gestor gera rascunho de escala por período via rodízio automático, edita manualmente e publica.
3. Horas do plantão calculadas pela regra: dia útil 14h (18h-08h); fim de semana ou feriado 24h (08h-08h). Feriados cadastrados no sistema.
4. Membro cadastra exceções (indisponibilidade) e preferências, e o rodízio as respeita.
5. Membro vê suas escalas e a da equipe, e acompanha saldo de horas previsto x realizado.
6. Membros e gestor recebem e-mails (SMTP) sobre publicação, alteração, trocas e lembrete de plantão.
7. Mudanças relevantes ficam registradas em trilha de auditoria.

## 3. Métricas de sucesso

Sem baseline quantitativo disponível ainda. Critérios observáveis propostos:

- A escala de um mês é gerada, revisada e publicada sem uso da planilha.
- Diferença de horas acumuladas entre membros, em escala gerada automaticamente para um trimestre, dentro de um limite configurável (sugestão: ≤ 24h entre maior e menor, com horas normalizadas pela disponibilidade de cada membro).
- 100% dos plantões publicados geram e-mail de lembrete ao responsável.

## 4. Não-objetivos / fora de escopo

- Várias equipes (modelo é de uma equipe; estrutura de dados não deve impedir evolução futura).
- Integração com PagerDuty ou outra ferramenta de acionamento; horas de acionamento reais não são importadas.
- Cálculo de remuneração, adicional ou integração com folha/ponto.
- Aplicativo móvel nativo; notificação push ou chat (Teams/Slack).
- Login com e-mail e senha local.
- Fluxo de post-mortem (aba existe na planilha, não faz parte do escopo).

## 5. Usuários / personas

- **Gestor:** gerencia a equipe e feriados, gera, revisa e publica escalas, aprova trocas, ajusta horas realizadas.
- **Membro:** engenheiro de plantão. Consulta escala, cadastra exceções e preferências, solicita trocas, vê saldo e recebe avisos.

## 6. User stories e requisitos funcionais

### Requisito 1: Autenticação SSO Entra ID

**User Story:** Como usuário, eu quero entrar com minha conta corporativa, para não gerenciar outra senha.

**Critérios de aceite:**
1. WHEN um usuário não autenticado acessa o sistema THE sistema SHALL redirecioná-lo ao login OIDC do Entra ID.
2. WHEN o login conclui com sucesso e o e-mail corresponde a um usuário pré-cadastrado e ativo THE sistema SHALL criar a sessão e, no primeiro acesso, vincular o usuário ao identificador (oid) do Entra ID.
3. IF o login falha, o token é inválido, o e-mail não está cadastrado ou o usuário está inativo THEN THE sistema SHALL negar acesso com mensagem clara e sem criar sessão.
4. WHEN o usuário faz logout ou a sessão expira THE sistema SHALL invalidar a sessão.
5. WHEN uma rota restrita ao gestor é chamada por membro THE sistema SHALL responder 403.
6. WHEN o sistema inicia THE sistema SHALL garantir que os e-mails da configuração inicial (variável de ambiente) existam como gestores ativos, criando-os se necessário.

### Requisito 2: Perfil do usuário

**User Story:** Como membro, eu quero ver e completar meu perfil, para que meus dados de contato estejam corretos.

**Critérios de aceite:**
1. WHEN o usuário abre o perfil THE sistema SHALL exibir nome, e-mail, papel e status vindos do cadastro.
2. WHEN o usuário altera campos editáveis (telefone opcional, preferências de notificação) THE sistema SHALL validar e salvar.
3. IF o usuário tenta alterar nome, e-mail ou papel THEN THE sistema SHALL recusar (nome e e-mail vêm do Entra ID; papel é do gestor).

### Requisito 3: Gestão de membros

**User Story:** Como gestor, eu quero gerenciar quem participa do rodízio, para que a escala reflita a equipe atual.

**Critérios de aceite:**
1. WHEN o gestor lista membros THE sistema SHALL exibir nome, e-mail, papel, status (ativo/inativo) e se participa do rodízio.
2. WHEN o gestor ativa um membro THE sistema SHALL incluí-lo em novas escalas; WHEN desativa um membro sem plantões futuros publicados THE sistema SHALL excluí-lo de novas escalas; IF o membro tem plantões futuros publicados THEN THE sistema SHALL listá-los e exigir reatribuição (alteração do gestor ou troca aprovada) antes de concluir a desativação.
3. WHEN o gestor altera o papel de um usuário THE sistema SHALL aplicar a permissão no próximo acesso.
4. IF a alteração removeria o último gestor ativo THEN THE sistema SHALL recusá-la.
5. WHEN o gestor pré-cadastra um membro (nome, e-mail, papel, participa do rodízio) THE sistema SHALL criar o usuário ativo sem vínculo de oid; IF o e-mail já existe THEN THE sistema SHALL recusar a duplicidade.
6. WHEN o gestor altera o campo "participa do rodízio" de um usuário THE sistema SHALL aplicá-lo a novas escalas; o padrão é sim para membro e não para gestor.

### Requisito 4: Cadastro de feriados

**User Story:** Como gestor, eu quero cadastrar feriados, para que esses dias sejam tratados como plantão de 24h.

**Critérios de aceite:**
1. WHEN o gestor cria, edita ou remove um feriado (data, nome, abrangência nacional/estadual/municipal) THE sistema SHALL persistir a mudança.
2. WHEN o sistema é inicializado THE sistema SHALL ter os feriados nacionais de 2026 e 2027 pré-carregados.
3. IF já existe feriado na mesma data e abrangência THEN THE sistema SHALL recusar duplicidade.
4. WHEN um feriado é criado, alterado ou removido numa data que já tem escala publicada THE sistema SHALL avisar o gestor que as horas desse dia mudam, sem recalcular automaticamente.
5. WHEN qualquer usuário consulta o calendário THE sistema SHALL exibir os feriados.
6. WHEN o gestor confirma o recálculo THE sistema SHALL recalcular tipo e horas dos plantões afetados, auditar a mudança e notificar os responsáveis (Requisito 12.2).

### Requisito 5: Exceções e preferências

**User Story:** Como membro, eu quero informar quando não posso ou prefiro não ficar de plantão, para que o rodízio me respeite.

**Critérios de aceite:**
1. WHEN o membro cadastra uma exceção (período, tipo: férias, folga, outro, observação) THE sistema SHALL tratá-la como bloqueio rígido na geração da escala.
2. WHEN o gestor cadastra férias coletivas (período) THE sistema SHALL não gerar plantão para nenhum membro nesses dias.
3. WHEN o gestor cadastra exceção para um membro THE sistema SHALL registrá-la com autoria.
4. WHEN o membro define preferências (dias da semana a evitar, máximo de plantões consecutivos desejado) THE sistema SHALL usá-las como restrição branda, no rodízio.
5. IF o período da exceção é inválido (fim antes do início) THEN THE sistema SHALL recusar.
6. WHEN uma exceção é criada sobre dia com plantão já publicado THE sistema SHALL avisar o gestor do conflito.

### Requisito 6: Regras de turno e horas

**User Story:** Como gestor, eu quero que o sistema aplique as regras de duração de plantão, para que as horas sejam consistentes.

**Critérios de aceite:**
1. WHEN o dia é útil (segunda a sexta, não feriado) THE sistema SHALL definir o plantão de 18h às 08h do dia seguinte, com 14 horas.
2. WHEN o dia é sábado, domingo ou feriado THE sistema SHALL definir o plantão de 08h às 08h do dia seguinte, com 24 horas.
3. WHEN o dia está em férias coletivas THE sistema SHALL definir 0 horas e nenhum responsável, mesmo sendo fim de semana ou feriado.
4. THE sistema SHALL calcular datas e horários no fuso America/Sao_Paulo.
5. THE sistema SHALL atribuir o plantão à data de início do turno.
6. WHEN um plantão cruza a virada do mês THE sistema SHALL contar suas horas integralmente no mês da data de início.

### Requisito 7: Geração automática do rodízio

**User Story:** Como gestor, eu quero gerar um rascunho de escala por período, para ganhar tempo e manter a carga equilibrada.

**Critérios de aceite:**
1. WHEN o gestor informa período e aciona a geração THE sistema SHALL criar escala em estado rascunho com um responsável por dia aplicável.
2. THE gerador SHALL nunca alocar usuário com exceção ativa, inativo, que não participa do rodízio ou em férias coletivas.
3. THE gerador SHALL minimizar a diferença de horas realizadas acumuladas entre membros (histórico das escalas publicadas), normalizadas pela disponibilidade de cada um no período, de modo que membro novo ou retornando de exceção longa não receba todos os plantões para compensar.
4. THE gerador SHALL distribuir plantões de fim de semana e feriado de forma equilibrada.
5. WHEN há preferências brandas THE gerador SHALL atendê-las quando possível sem violar regras rígidas ou o equilíbrio, e informar as violações.
6. IF não houver membro elegível num dia THEN THE sistema SHALL deixar o dia sem responsável e sinalizá-lo ao gestor.
7. WHEN a geração é repetida com os mesmos dados THE gerador SHALL produzir o mesmo resultado.
8. THE período da escala SHALL ser livre (data inicial e final); IF o período se sobrepõe a rascunho existente THEN THE sistema SHALL recusar a geração.

### Requisito 8: Revisão, edição e publicação

**User Story:** Como gestor, eu quero revisar e ajustar o rascunho antes de publicar, para ter controle final da escala.

**Critérios de aceite:**
1. WHEN o gestor edita o responsável de um dia no rascunho THE sistema SHALL validar conflitos (exceção, inativo) e exibir avisos.
2. WHEN o gestor publica o rascunho THE sistema SHALL torná-lo visível aos membros e acionar notificações (Requisito 12).
3. IF o rascunho tem dias sem responsável aplicável THEN THE sistema SHALL exigir confirmação explícita para publicar.
4. WHEN o gestor altera plantão de escala já publicada THE sistema SHALL exigir motivo, registrar a alteração, notificar os envolvidos e auditar.
5. IF já existe escala publicada que se sobrepõe ao período THEN THE sistema SHALL recusar publicar o novo rascunho.
6. WHILE a escala está em rascunho THE sistema SHALL ocultá-la dos membros.
7. WHEN o gestor publica THE sistema SHALL gravar em cada plantão o responsável e as horas originais (previsto) para preservar o previsto após trocas e alterações.

### Requisito 9: Visualização de escalas

**User Story:** Como membro, eu quero ver minhas escalas e a da equipe, para me planejar.

**Critérios de aceite:**
1. WHEN o membro abre "Minha escala" THE sistema SHALL listar seus plantões publicados, futuros e passados, com data, período e horas.
2. WHEN o usuário abre a escala da equipe THE sistema SHALL exibir calendário mensal com responsável, tipo do dia (útil, fim de semana, feriado, férias coletivas) e horas.
3. WHEN o usuário filtra por período ou membro THE sistema SHALL aplicar o filtro.
4. THE sistema SHALL destacar o plantão do próprio usuário.

### Requisito 10: Troca de plantão

**User Story:** Como membro, eu quero pedir troca de plantão com um colega, para resolver imprevistos.

**Critérios de aceite:**
1. WHEN o membro solicita troca de um plantão futuro seu com outro membro THE sistema SHALL criar a solicitação em estado pendente e notificar o colega.
2. WHEN o colega aceita THE sistema SHALL colocar a solicitação em aguardo de aprovação do gestor.
3. WHEN o gestor aprova THE sistema SHALL aplicar a troca na escala, atualizar horas e notificar os envolvidos.
4. WHEN o colega recusa, o solicitante cancela ou o gestor rejeita THE sistema SHALL encerrar a solicitação e notificar.
5. IF o colega tem exceção na data ou o plantão já passou THEN THE sistema SHALL recusar a solicitação; para exceção do colega, a mensagem é genérica ("colega indisponível nessa data") e não revela o motivo.
6. THE sistema SHALL suportar troca de um plantão por outro (permuta) e cessão simples (colega assume o plantão).

### Requisito 11: Saldo de horas previsto x realizado

**User Story:** Como membro, eu quero ver minhas horas previstas e realizadas, para acompanhar minha carga.

**Critérios de aceite:**
1. THE sistema SHALL calcular horas previstas por membro e período a partir do responsável e das horas originais gravados na publicação.
2. THE sistema SHALL calcular horas realizadas a partir da escala vigente após trocas e alterações, para plantões já encerrados, mais ajustes do gestor.
3. WHEN o gestor lança ajuste (membro, data, horas positivas ou negativas, motivo) THE sistema SHALL aplicá-lo ao realizado e auditá-lo.
4. WHEN o membro consulta o saldo THE sistema SHALL exibir, por mês (da data de início do plantão) e acumulado do ano, previsto, realizado e diferença, com detalhamento por plantão.
5. WHEN o gestor consulta o saldo THE sistema SHALL exibir o comparativo de todos os membros.
6. IF o membro tenta ver saldo de outro membro THEN THE sistema SHALL negar acesso (exceto gestor).

### Requisito 12: Notificações e alertas por e-mail

**User Story:** Como membro, eu quero receber e-mails sobre meus plantões, para não esquecer nem ser surpreendido.

**Critérios de aceite:**
1. WHEN uma escala é publicada THE sistema SHALL enviar a cada membro um e-mail com seus plantões do período.
2. WHEN um plantão publicado é alterado THE sistema SHALL notificar os membros afetados.
3. WHEN há solicitação, aceite, recusa, aprovação ou rejeição de troca THE sistema SHALL notificar os envolvidos.
8. WHEN o colega aceita uma troca THE sistema SHALL enviar e-mail ao gestor informando que há troca aguardando aprovação.
4. WHEN faltam 24 horas para o início de um plantão THE sistema SHALL enviar lembrete ao responsável, uma única vez por plantão.
5. IF o envio SMTP falha THEN THE sistema SHALL reenfileirar com tentativas limitadas, registrar a falha e não bloquear a ação do usuário.
6. WHERE o membro desativou lembretes no perfil THE sistema SHALL não enviar lembretes (notificações de alteração e troca continuam).
7. THE e-mails SHALL ser em português (pt-BR) e conter data, período e horas do plantão.

### Requisito 13: Auditoria

**User Story:** Como gestor, eu quero rastrear quem mudou o quê, para esclarecer divergências de escala.

**Critérios de aceite:**
1. WHEN há criação, alteração ou remoção de escala, plantão, feriado, exceção, ajuste, troca ou papel de usuário THE sistema SHALL registrar ator, ação, entidade, valores antes e depois e data/hora.
2. WHEN o gestor consulta a auditoria THE sistema SHALL permitir filtro por período, ator e tipo de entidade.
3. THE registros de auditoria SHALL ser imutáveis pela aplicação.
4. IF o usuário é membro THEN THE sistema SHALL negar acesso à tela de auditoria.

## 7. Requisitos não-funcionais

- **RNF-1 Segurança:** OIDC com PKCE, sessão em cookie HttpOnly/Secure/SameSite; autorização por papel em toda rota; validação de entrada com schema; proteção contra CSRF; segredos só por variável de ambiente.
- **RNF-2 Privacidade/LGPD:** dados pessoais limitados a nome, e-mail e telefone opcional; membro vê só dados da equipe necessários (escala), nunca saldo ou exceções detalhadas de outros (nem o motivo de indisponibilidade em recusas de troca); política de retenção do log de auditoria a definir (Q7).
- **RNF-3 Confiabilidade:** envio de e-mail assíncrono com retry; job de lembrete idempotente (sem duplicar em reinício).
- **RNF-4 Fuso e datas:** armazenar instantes em UTC e datas de plantão como data local America/Sao_Paulo; turnos que cruzam meia-noite tratados corretamente.
- **RNF-5 Desempenho:** geração de escala de 3 meses para até 20 membros em até 5 segundos.
- **RNF-6 Usabilidade:** interface em pt-BR, responsiva, minimalista (paleta neutra com uma cor de acento, tipografia do sistema, tema claro/escuro automático, poucos elementos por tela, sem biblioteca de componentes pesada) e com acessibilidade básica (teclado, contraste, rótulos).
- **RNF-7 Observabilidade:** logs estruturados, endpoint `/health`, erros de SMTP registrados.
- **RNF-8 Qualidade:** testes unitários do domínio (turnos e gerador) com datas fixas; testes de API; E2E do fluxo principal com servidor SMTP de teste em memória.

## 8. Premissas

- Um único tenant Entra ID, com app registration disponível ao projeto (desenvolvimento usa mock de OIDC; vira pergunta em aberto Q1 se a hospedagem exigir ajuste).
- Uma equipe (SRE Central) com cerca de 5 a 20 membros.
- Gestores iniciais informados por configuração; demais usuários pré-cadastrados por e-mail pelo gestor (só e-mail cadastrado entra).
- Servidor SMTP disponível, com credenciais fornecidas por configuração.
- Realizado = escala vigente após trocas e alterações, mais ajuste manual do gestor. Sem importação de acionamentos reais (confirmado como default; Q4 cobre mudança).
- Feriados nacionais pré-carregados; estaduais e municipais por cadastro manual.
- Férias coletivas = nenhum plantão e 0 horas, conforme a planilha atual (dias ficam sem responsável).
- Stack: React + Hono + PostgreSQL, TypeScript, monorepo; node 22 e npm disponíveis; pnpm e Docker não estão instalados na máquina de desenvolvimento.

## 9. Riscos

- Regras de equilíbrio do rodízio divergem da prática atual da equipe (ordem fixa de rodízio na planilha); resultado pode não ser aceito sem ajuste de pesos.
- Turnos que cruzam a meia-noite ou o mês geram erros de data e horas se o domínio não for isolado e testado; regras de fuso devem vir de biblioteca com tzdata, não de offset fixo.
- Dependência de app registration no Entra ID e de SMTP de terceiros pode bloquear teste de ponta a ponta.
- Sem Docker local, PostgreSQL de desenvolvimento precisa de instalação nativa ou serviço remoto.
- Troca aprovada em escala já publicada altera histórico de horas; sem auditoria clara o saldo gera disputa.

## 10. Perguntas em aberto

### Q1. Onde será hospedado e como será o deploy?
- **Contexto:** não definido na entrevista (possível AWS, dado o ecossistema).
- **Sugestão de default:** entregar Dockerfile e README de execução, sem IaC nem pipeline de deploy nesta rodada.
- **Decisão:** _(preencher quando decidido)_

### Q2. Importar a planilha de 2026 como carga inicial?
- **Contexto:** a planilha tem escala existente (Data, Período, Horas, Responsável) e equipe.
- **Sugestão de default:** sem importador; gestor cadastra membros e gera a escala a partir do próximo período. Histórico de horas começa zerado.
- **Decisão:** _(preencher quando decidido)_

### Q3. Feriados estaduais e municipais: só cadastro manual ou importação automática (ex.: API pública)?
- **Contexto:** o gestor pediu cadastro no sistema; importação não foi discutida.
- **Sugestão de default:** cadastro manual mais nacionais pré-carregados (2026 e 2027).
- **Decisão:** _(preencher quando decidido)_

### Q4. "Realizado" precisa de lançamento de horas de acionamento pelos membros?
- **Contexto:** pergunta não respondida na entrevista.
- **Sugestão de default:** realizado = escala vigente após trocas, mais ajuste manual do gestor; sem lançamento pelo membro.
- **Decisão:** _(preencher quando decidido)_

### Q5. Parâmetros de equilíbrio do rodízio (máximo de plantões consecutivos, limite de diferença de horas, peso de fins de semana)?
- **Contexto:** a planilha mostra rodízio sequencial entre 5 pessoas, sem regra explícita.
- **Sugestão de default:** brando: evitar dias consecutivos para a mesma pessoa; equilibrar horas realizadas e fins de semana/feriados, normalizados pela disponibilidade; valores configuráveis pelo gestor depois.
- **Decisão:** _(preencher quando decidido)_

### Q6. Gerenciador de pacotes e ORM/migração?
- **Contexto:** pnpm não está instalado; decisão técnica não discutida.
- **Sugestão de default:** npm workspaces; PostgreSQL via `postgres` (postgres.js) com migrações SQL versionadas up/down e runner próprio (adotado na task 1.2, pois Drizzle não reverte migrações).
- **Decisão:** _(preencher quando decidido)_

### Q7. Política de retenção de auditoria e de dados pessoais (LGPD)?
- **Contexto:** não definida.
- **Sugestão de default:** reter auditoria por 5 anos; sem exclusão automática nesta rodada.
- **Decisão:** _(preencher quando decidido)_
