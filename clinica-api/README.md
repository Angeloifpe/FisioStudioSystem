# API da Clínica de Fisioterapia e Pilates

Node.js + Express + TypeScript, conectada ao banco PostgreSQL `clinica` (pasta `clinica-db`).

## Rodar no Windows

1. O banco precisa estar criado e atualizado (rode antes o `instalar.bat` da pasta `clinica-db`; ele aplica as atualizações 003, 004 e 005).
2. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele:
   - instala o Node.js se faltar;
   - pede a senha do PostgreSQL e cria o arquivo `.env`;
   - roda `npm install`;
   - cria o login da cliente (administradora).
3. Abra http://localhost:3333/saude no navegador. Se aparecer `"banco": "ok"`, está tudo ligado.

## Página de testes

Com a API rodando, abra **http://localhost:3333/teste** no navegador. É uma página simples para testar sem o app:

- **Paciente:** cadastro, aula experimental, avaliação, agendar, confirmar presença, pedir cancelamento, marcar reposição (aba **Reposição**, com os dias e horários com vaga) e ver notificações. Aluno com horário fixo vê em Agendar → Pilates só as aulas das turmas dele (e as reposições marcadas) nas próximas 3 semanas.
- **Cliente:** abrir e bloquear horários, agenda do dia (avaliar, presença, falta, remarcar, cancelar, registrar atendimento), cancelar um dia inteiro, decidir pedidos de cancelamento, pacientes (histórico, reabrir, alta, interromper) e notificações.

Para testar a interação, abra duas janelas (uma normal e outra anônima): uma com o login da cliente e outra com um paciente. As notificações se atualizam a cada 30 segundos ou quando a página é recarregada.

## Dados de teste

Dê dois cliques em **`dados-teste.bat`** (ou rode `npm run dados-teste`). Ele cria:

- horários de segunda a sexta (menos feriados), de 3 semanas atrás até 3 semanas à frente: 07h avaliação, 08h às 12h fisioterapia, 17h às 20h pilates (pula horários que já existem);
- 8 pacientes com e-mail `@teste.clinica` e senha `teste123`, cada um numa situação diferente:

| E-mail | Situação para testar |
| --- | --- |
| `ana@teste.clinica` | Liberada só para pilates; pilates fixo às terças e quintas 16h, histórico com uma falta |
| `bruno@teste.clinica` | Liberado para os dois (duas avaliações); fisioterapia com registros; pedido de cancelamento esperando a cliente; sessão de 45 min |
| `carla@teste.clinica` | Liberada só para pilates; avisou falta no pilates e remarcou em outra turma |
| `diego@teste.clinica` | Liberado; avisou falta no pilates: remarcação liberada para usar; sessão de 60 min |
| `elisa@teste.clinica` | Aguardando avaliação; aula experimental paga (Pix) e avaliação de pilates marcadas |
| `fabio@teste.clinica` | Aguardando avaliação; 2 faltas em aula experimental (gera alerta) |
| `gabriela@teste.clinica` | Não liberada na avaliação |
| `henrique@teste.clinica` | Recebeu alta |

As turmas de pilates têm 8 vagas; no próximo dia de atendimento a segunda turma foi reduzida para 4 vagas e fica cheia ou quase, para testar o "sem vagas".

Para apagar os pacientes de teste (e tudo ligado a eles): **`limpar-dados-teste.bat`** ou `npm run dados-teste -- --limpar`. Os horários abertos continuam na agenda.

## Rodar pelo terminal

```bash
cp .env.example .env        # e preencha a senha do banco e o JWT_SECRET
npm install
npm run criar-admin -- clinica@exemplo.com senha123
npm run dev                 # desenvolvimento, reinicia ao salvar
# ou: npm run build && npm start
```

## Autenticação

`POST /auth/login` devolve um `token`. Nas demais rotas, envie o cabeçalho:

```
Authorization: Bearer <token>
```

Há dois papéis: `ADMIN` (a cliente) e `PACIENTE`.

## Rotas

### Acesso

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| POST | `/auth/cadastro` | público | Pré-cadastro do paciente (entra como `AGUARDANDO_AVALIACAO`) |
| POST | `/auth/login` | público | Login; devolve o token, o papel e a situação |
| POST | `/auth/login` → `trocar_senha` | — | Se `true`, o usuário entrou com senha temporária: só `/auth/me` e `/auth/trocar-senha` funcionam até criar uma senha nova |
| GET | `/auth/me` | logado | Dados de quem está logado (inclui `trocar_senha`) |
| POST | `/auth/pedir-nova-avaliacao` | PACIENTE | Não liberado numa avaliação: pede à clínica uma nova avaliação (avisa a cliente) |
| POST | `/auth/trocar-senha` | logado | `{ senha_atual, nova_senha }`; troca a própria senha e devolve um `token` novo |

### Módulo 1 — Pacientes

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| GET | `/pacientes?situacao=&busca=` | ADMIN | Lista pacientes (filtro por situação, busca por nome ou CPF) |
| GET | `/pacientes/:id` | ADMIN | Dados cadastrais, avaliações e mudanças de situação |
| PATCH | `/pacientes/:id` | ADMIN | Edita dados cadastrais e a duração da sessão de fisioterapia (`duracao_fisioterapia_min`: 30 a 60, de 5 em 5; sem definir, 30) |
| POST | `/pacientes/:id/situacao` | ADMIN | `AGUARDANDO_AVALIACAO` (reabrir), `ALTA` ou `INTERROMPIDO` |
| GET | `/pacientes/:id/historico` | ADMIN | Agendamentos e registros de atendimento |
| POST | `/pacientes/:id/liberar-nova-avaliacao` | ADMIN | Libera uma nova avaliação para quem não foi liberado (`motivo?` vai no aviso); quem não tinha liberação nenhuma volta a aguardar avaliação |
| POST | `/pacientes/:id/senha-temporaria` | ADMIN | Cria uma senha temporária (`{ senha?, validade_horas? }`, padrão: gerada e válida por 72 h). Devolve a senha uma única vez; o paciente troca no primeiro login |

### Módulo 2 — Agenda

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| GET | `/horarios?de=&ate=&modalidade=` | logado | Horários com vagas (paciente vê só futuros, livres e com vaga) |
| POST | `/horarios` | ADMIN | Abre um horário ou uma lista de horários |
| PATCH | `/horarios/:id` | ADMIN | Bloqueia/desbloqueia (`bloqueado`) e, no pilates, muda as vagas daquela aula naquele dia (`capacidade`, 1 a 8) |
| GET | `/horarios/funcionamento` | logado | Horário de funcionamento por dia da semana (dia sem faixa = fechado) |
| PUT | `/horarios/funcionamento` | ADMIN | Troca as faixas: `[{ "dia_semana": 1, "abre": "06:00", "fecha": "11:00" }, ...]` (1 = segunda) |
| GET | `/horarios/fora-do-funcionamento` | ADMIN | Horários futuros com agendamentos que ficaram fora do funcionamento ou da grade de pilates (`motivo`) |

Horário de funcionamento (padrão, vindo dos áudios da cliente): segunda 06:00–11:00 e 16:00–19:10; terça e quinta 08:00–11:00 e 15:00–19:10; quarta 06:00–11:00; sexta fechada. Um horário só pode ser aberto se couber inteiro numa faixa do dia, e o paciente só vê horários dentro do funcionamento.
| POST | `/agendamentos` | PACIENTE | Agenda, marca aula experimental ou reposição (`horario_id`, `experimental?`, `reposicao_de?`; avisa a cliente). Na avaliação, `avaliacao_para` é obrigatório: `PILATES` ou `FISIOTERAPIA` (uma avaliação por modalidade) |
| GET | `/agendamentos/meus` | PACIENTE | Agendamentos do próprio paciente (na reposição, `reposicao_de_inicio` traz a data da aula que está sendo reposta) |
| GET | `/agendamentos/reposicoes-disponiveis` | PACIENTE | Atendimentos cancelados com reposição/remarcação liberada e não usada (com a `modalidade`) |
| POST | `/agendamentos/:id/confirmar-presenca` | PACIENTE | Confirma que vai comparecer (avisa a cliente) |
| POST | `/agendamentos/:id/solicitar-cancelamento` | PACIENTE | Avisa que não vai. **Pilates regular:** a qualquer hora até o fim da aula, cancela na hora e libera a vaga; com pelo menos 30 min de antecedência também dá a remarcação (`remarcacao_liberada`), com menos a aula conta como dada. Vale também para a aula de reposição: no prazo, a reposição volta; fora do prazo, ela é gasta. **Demais:** pede o cancelamento para a cliente decidir (`motivo?`), até o fim do atendimento |
| GET | `/agendamentos?data=AAAA-MM-DD&status=` | ADMIN | Atendimentos do dia (padrão: hoje) |
| GET | `/agendamentos/cancelamentos-pendentes` | ADMIN | Pedidos de cancelamento esperando decisão |
| POST | `/agendamentos/:id/decidir-cancelamento` | ADMIN | `{ "aprovar": true, "liberar_reposicao": true }` (avisa o paciente) |
| POST | `/agendamentos/pela-clinica` | ADMIN | Agenda por um paciente (`paciente_id`, `horario_id`, `experimental?`, `reposicao_de?`, `avaliacao_para` na avaliação) |
| POST | `/agendamentos/:id/cancelar` | ADMIN | Cancela por conta própria (`motivo?` vai na notificação; `liberar_remarcacao?`) |
| POST | `/agendamentos/cancelar-em-lote` | ADMIN | Cancela um dia (`data`) ou horários (`horario_ids`); `motivo` obrigatório vai para cada paciente; `liberar_remarcacao` e `bloquear_horarios` (padrão `true`) |
| POST | `/agendamentos/:id/remarcar` | ADMIN | Troca o paciente de horário, mesma modalidade (`horario_id`); na fisioterapia também por `inicio` (mantém a duração) |
| GET | `/agendamentos/fisioterapia/inicios?data=` | logado | Inícios livres para a fisioterapia no dia, com a duração do paciente (a cliente informa `paciente_id` ou `duracao_min`) |
| POST | `/agendamentos/fisioterapia` | PACIENTE | Marca fisioterapia pelo início (`inicio`, `reposicao_de?`); o horário é criado com a duração do paciente |
| POST | `/agendamentos/fisioterapia/pela-clinica` | ADMIN | Idem pela cliente (`paciente_id`, `inicio`, `duracao_min?`, `reposicao_de?`) |

Fisioterapia: a sessão dura de 30 a 60 minutos, conforme o cadastro do paciente (sem definir, 30 min; se for mais longa, a cliente muda no paciente). O paciente escolhe só o início: ele precisa caber no funcionamento, fora das aulas da grade de pilates (mesmo que a aula ainda não tenha sido aberta) e sem bater com outro atendimento. Se o atendimento for cancelado, o horário é liberado para outra pessoa. Horários de fisioterapia abertos pela cliente em `POST /horarios` continuam funcionando.
| POST | `/agendamentos/:id/presenca` | ADMIN | `{ "compareceu": true }` confirma; `false` registra falta |
| POST | `/agendamentos/:id/pagamento` | ADMIN | Registra que a aula experimental foi paga antes (`{ "forma": "PIX" }` ou `"APLICATIVO"`) |

Aula experimental: sem pagamento, o paciente pode desmarcar e marcar de novo (e marcar outra se faltar). Paga antes, ela não pode ser desmarcada pelo paciente e, se ele faltar, conta como dada (`conta_como_dada: true`): não dá para marcar outra. Se a cliente remarcar, o pagamento vai junto.
| POST | `/agendamentos/:id/avaliacao` | ADMIN | Conclui a avaliação (`resultado`: `LIBERADO`/`NAO_LIBERADO`, `observacoes?`, `liberar_para?` só para avaliações antigas de `AMBAS`, para liberar uma modalidade só) |

Avaliação por modalidade: cada avaliação é de uma modalidade só, pilates ou fisioterapia; o paciente escolhe ao pedir. Liberado, ele só agenda a modalidade avaliada (`liberado_pilates` / `liberado_fisioterapia` em `/auth/me` e `/pacientes`). Para as duas, faz uma avaliação de cada; pode deixar as duas marcadas ao mesmo tempo (uma pendente por modalidade). Não liberado numa avaliação, continua com o que já tinha, mas só faz outra avaliação (de qualquer modalidade) depois que a clínica liberar (`nova_avaliacao_bloqueada`; o paciente pede em `/auth/pedir-nova-avaliacao`). A aula experimental de pilates é para quem ainda não foi liberado para o pilates. Reabrir o cadastro zera as liberações.

### Pilates: limite semanal e horário fixo

Regras: até 2 aulas de pilates por semana, em dias diferentes (reposição e aula experimental não contam). O aluno pode fixar até 2 turmas; a vaga fica reservada em todas as aulas dessas turmas enquanto ele estiver liberado, inclusive nas que a clínica abrir depois. A clínica atende de segunda a quinta, no horário de funcionamento (sexta fechada).

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| GET | `/pilates/turmas` | logado | Turmas de pilates (dia da semana 1–5 + hora) com aulas futuras abertas |
| GET | `/pilates/fixos?paciente_id=` | logado | Horários fixos ativos (o aluno vê os dele; a cliente filtra por paciente) |
| POST | `/pilates/fixos` | logado | Fixa uma turma: `{ "dia_semana": 2, "hora": "18:00" }` (a cliente informa também `paciente_id`); avisa o outro lado |
| DELETE | `/pilates/fixos/:id` | logado | Deixa de ser fixo e cancela as aulas futuras reservadas por ele |
| GET | `/pilates/turmas/alunos-fixos` | ADMIN | Quem é fixo em cada turma |
| GET | `/pilates/grade` | logado | Grade semanal das aulas de pilates, com a capacidade de cada aula |
| PATCH | `/pilates/grade/capacidade` | ADMIN | Muda as vagas de uma turma (`dia_semana`, `inicio`, `capacidade` 1 a 8, `aplicar_nas_aulas_abertas?` padrão `true`); devolve as aulas que já têm mais alunos e ficaram como estavam |
| GET | `/pilates/config` | logado | Capacidade padrão das turmas (8) e antecedência mínima do aviso de falta (30 min) |
| PUT | `/pilates/config` | ADMIN | Muda `capacidade_padrao_pilates` e/ou `antecedencia_aviso_falta_min` |
| PUT | `/pilates/grade` | ADMIN | Troca a grade: `[{ "dia_semana": 1, "inicio": "06:00", "fim": "07:00" }, ...]` |
| POST | `/pilates/grade/abrir` | ADMIN | Abre todas as aulas da grade num período (`{ "de": "2026-11-16", "ate": "2026-12-18" }`, até 120 dias); pula feriados e o que já existe |

Grade (tabela da cliente): segunda 06:00, 08:00, 09:00, 16:00, 17:10, 18:10; terça 08:00, 09:00, 15:00, 16:00, 17:10, 18:10; quarta 06:00, 08:00, 09:00; quinta 08:30, 09:30, 15:00, 16:00, 17:10, 18:10 (aulas de 1 hora). Aula de pilates só pode ser aberta num horário da grade.

Turmas e vagas: cada turma tem até 8 alunos (padrão 8). A cliente reduz uma turma inteira (`/pilates/grade/capacidade`) ou só a aula de um dia (`PATCH /horarios/:id`); não dá para reduzir abaixo dos alunos já agendados. Antes de ter aulas de pilates, o aluno escolhe os dias e horários fixos (`POST /pilates/fixos`); pode mudar depois. Pelo app o aluno não marca aula avulsa de pilates (`POST /agendamentos` recusa sem `reposicao_de`; aula experimental continua livre). O aluno matriculado tem a vaga reservada em todas as aulas da turma dele (ao fixar uma turma, as avulsas que ele já tinha marcado são canceladas e as aulas da turma entram no lugar): fora das turmas dele, só agenda usando uma remarcação (`POST /agendamentos` com `reposicao_de`). Se não puder ir num dia, avisa pelo app a qualquer hora (até o fim da aula): a aula daquele dia é cancelada e a vaga fica livre para qualquer aluno. Avisando com pelo menos 30 minutos de antecedência, ele ganha uma remarcação (em qualquer turma); com menos, a aula conta como dada.

### Feriados

A clínica não abre em feriado nem no fim de semana. Os feriados nacionais e o estadual de Pernambuco (6 de março) já vêm cadastrados; a cliente acrescenta São João, Carnaval e os feriados da cidade.

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| GET | `/feriados?de=AAAA-MM-DD&ate=AAAA-MM-DD` | logado | Feriados do período (padrão: próximos 12 meses) |
| POST | `/feriados` | ADMIN | `{ "data": "2027-06-24", "nome": "São João", "tipo": "MUNICIPAL" }`; cancela os atendimentos do dia e avisa os pacientes (feriado não dá remarcação) |
| DELETE | `/feriados/:data` | ADMIN | Remove o feriado (dá para abrir horários nesse dia de novo) |

### Módulo 3 — Registro de atendimentos

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| POST | `/registros` | ADMIN | Registra atendimento (`paciente_id`, `data_atendimento`, `observacoes?`, `agendamento_id?`) |
| GET | `/registros?paciente_id=` | ADMIN | Registros anteriores do paciente |
| PATCH | `/registros/:id` | ADMIN | Edita data ou observações |

### Notificações (interação paciente ↔ cliente)

Cada ação gera um aviso dentro do app, com a mensagem pronta para mostrar:

- **Para a cliente:** cadastro novo, agendamento, aula experimental, reposição marcada, presença confirmada, pedido de cancelamento.
- **Para o paciente:** resultado da avaliação, cancelamento aprovado ou recusado (e reposição liberada), agendamento, remarcação ou cancelamento feitos pela clínica (com o motivo escrito pela cliente), alta, interrupção ou reabertura.

Exemplo de aviso de cancelamento em lote: *"A clínica cancelou sua sessão de fisioterapia de 04/11 às 08:00. Clínica fechada para manutenção elétrica. A remarcação foi liberada: escolha um novo horário de fisioterapia."*

Para remarcar, o app lista `/agendamentos/reposicoes-disponiveis`, mostra os horários da mesma modalidade em `/horarios?modalidade=...` e agenda com `reposicao_de` igual ao id do atendimento cancelado.

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| GET | `/notificacoes?nao_lidas=true&limite=50` | logado | Notificações de quem está logado, mais novas primeiro |
| GET | `/notificacoes/contagem` | logado | Quantidade de não lidas (para o "sininho") |
| POST | `/notificacoes/:id/lida` | logado | Marca uma como lida |
| POST | `/notificacoes/ler-todas` | logado | Marca todas como lidas |

Os avisos ficam só dentro do app (o escopo excluiu WhatsApp e notificações externas). O app deve consultar `/notificacoes/contagem` ao abrir e a cada 30 segundos, mais ou menos.

### Outros

| Método | Rota | Quem | O que faz |
| --- | --- | --- | --- |
| GET | `/alertas/faltas-experimental` | ADMIN | Pacientes com 2+ faltas em aula experimental, com a observação |
| GET | `/saude` | público | Confere se a API e o banco estão no ar |

## Datas e horários

- Data e hora em ISO com fuso: `2026-11-03T14:00:00-03:00`. O banco guarda em UTC.
- Datas simples (nascimento, atendimento): `AAAA-MM-DD`.

## Erros

Todas as respostas de erro têm o formato `{ "erro": "mensagem" }`. O app pode mostrar a mensagem direto ao usuário.

| Status | Quando |
| --- | --- |
| 400 | Dados inválidos (vem com `campos` dizendo qual campo está errado) |
| 401 | Sem login ou token expirado |
| 403 | Sem permissão para a ação |
| 404 | Registro não encontrado |
| 409 | Conflito: e-mail ou CPF repetido, horário sobreposto, experimental repetida |
| 422 | Regra de negócio: sem vaga, paciente não liberado, horário bloqueado etc. |

## Estrutura

```
src/
  index.ts             inicia o servidor
  app.ts               monta o Express e as rotas
  config.ts            lê o .env
  db.ts                conexão com o PostgreSQL e transações
  erros.ts             converte erros do banco em respostas HTTP
  middlewares/auth.ts  login com JWT e controle por papel
  routes/              uma rota por módulo
  scripts/criar-admin.ts
```

As regras de negócio ficam no banco (gatilho e funções do `001_schema.sql`). A API valida a entrada, controla quem pode fazer o quê e traduz os erros do banco em mensagens para o app.
