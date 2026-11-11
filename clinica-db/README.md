# Banco de dados — Clínica de Fisioterapia e Pilates

PostgreSQL 13 ou mais novo (testado no 16).

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `001_schema.sql` | Cria tipos, tabelas, índices, views, gatilhos e funções de operação |
| `002_testes.sql` | Testa as regras de negócio dentro de uma transação e desfaz tudo no final |
| `003_ajustes_cliente.sql` | Cliente cancela e remarca agendamentos por conta própria |
| `004_notificacoes.sql` | Confirmação de presença pelo paciente e notificações dentro do app |
| `005_cancelamento_em_lote.sql` | Cliente cancela um dia ou horários, avisa com o motivo e libera a remarcação |
| `006_pilates_semanal.sql` | Clínica de segunda a sexta; pilates até 2 aulas por semana; horário fixo de pilates |
| `007_feriados.sql` | Feriados nacionais e de Pernambuco; sem atendimento em feriado nem no fim de semana |
| `008_senha_temporaria.sql` | Troca de senha e senha temporária criada pela cliente para o paciente |
| `009_funcionamento_e_experimental_paga.sql` | Horário de funcionamento por dia (sexta fechada, quarta à tarde fechada); aula experimental paga não é desmarcada e, com falta, conta como dada |
| `010_grade_pilates_e_duracao_fisio.sql` | Grade fixa das aulas de pilates (fisioterapia e avaliação não caem nelas); duração da fisioterapia por paciente (30–60 min); terça e quinta à tarde até 19:10 |
| `011_duracao_fisio_padrao_30.sql` | Sessão de fisioterapia sem duração definida passa a ser de 30 min (a cliente aumenta no paciente) |
| `012_capacidade_e_aviso_de_falta.sql` | Capacidade das turmas de pilates definida pela cliente (até 8, por turma ou por aula); aviso de falta com 30 min de antecedência cancela na hora, libera a vaga e dá remarcação |
| `013_cancelar_a_qualquer_hora.sql` | Aluno avisa falta no pilates a qualquer hora (até o fim da aula); os 30 min decidem só se ganha remarcação |
| `014_avaliacao_por_modalidade.sql` | Avaliação de pilates, de fisioterapia ou das duas: o paciente só agenda a modalidade em que foi liberado |
| `015_avaliacoes_separadas.sql` | Cada avaliação é de uma modalidade só; dá para ter a de pilates e a de fisioterapia marcadas ao mesmo tempo |
| `017_feriado_sem_remarcacao.sql` | Feriado cancela os atendimentos do dia e avisa os pacientes, sem remarcação |
| `018_reposicao_cancelada_no_prazo.sql` | Cancelar a aula de reposição com 30 min de antecedência devolve a reposição; com menos, conta como dada |
| `019_nova_avaliacao_liberada_pela_clinica.sql` | Não liberado numa avaliação: nova avaliação (de qualquer modalidade) só depois que a clínica liberar; o paciente pede pelo app |
| `016_fixo_substitui_avulsas.sql` | Ao fixar uma turma, as aulas avulsas de pilates já marcadas são canceladas e as aulas da turma entram no lugar |

## Como rodar

```bash
createdb clinica
psql -d clinica -v ON_ERROR_STOP=1 -f 001_schema.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 003_ajustes_cliente.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 004_notificacoes.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 005_cancelamento_em_lote.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 006_pilates_semanal.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 007_feriados.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 008_senha_temporaria.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 009_funcionamento_e_experimental_paga.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 010_grade_pilates_e_duracao_fisio.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 011_duracao_fisio_padrao_30.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 012_capacidade_e_aviso_de_falta.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 013_cancelar_a_qualquer_hora.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 014_avaliacao_por_modalidade.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 015_avaliacoes_separadas.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 016_fixo_substitui_avulsas.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 017_feriado_sem_remarcacao.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 018_reposicao_cancelada_no_prazo.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 019_nova_avaliacao_liberada_pela_clinica.sql
psql -d clinica -v ON_ERROR_STOP=1 -f 002_testes.sql   # opcional, depois das atualizações
```

Com Docker:

```bash
docker run -d --name clinica-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=clinica -p 5432:5432 postgres:16
docker cp 001_schema.sql clinica-db:/
docker exec clinica-db psql -U postgres -d clinica -v ON_ERROR_STOP=1 -f /001_schema.sql
```

## Funções para o backend

As operações de várias etapas já estão no banco, cada uma em uma transação:

| Função | Uso |
| --- | --- |
| `fn_concluir_avaliacao(agendamento_id, resultado, observacoes, avaliado_por)` | Marca a avaliação como realizada, grava o resultado e libera ou não o paciente |
| `fn_decidir_cancelamento(agendamento_id, aprovar, decidido_por, liberar_reposicao)` | Aprova ou recusa o pedido de cancelamento; no pilates pode liberar reposição |
| `fn_mudar_situacao_paciente(paciente_id, nova_situacao, motivo, alterado_por)` | Reabre (`AGUARDANDO_AVALIACAO`), dá `ALTA` ou `INTERROMPIDO`; alta e interrupção cancelam os agendamentos futuros |
| `fn_cancelar_pela_clinica(agendamento_id, cancelado_por, motivo, liberar_reposicao)` | Cliente cancela por conta própria e pode liberar a remarcação |
| `fn_cancelar_horarios(horario_ids[], cancelado_por, motivo, liberar_remarcacao, bloquear_horarios)` | Cancela todos os atendimentos dos horários (um dia inteiro, por exemplo), avisa cada paciente com o motivo e libera a remarcação |
| `fn_remarcar_agendamento(agendamento_id, novo_horario_id, remarcado_por)` | Cancela o atual e cria outro no novo horário (mesma modalidade), ligado pelo `remarcado_de` |
| `fn_notificar_agendamento(tipo, agendamento_id, mensagem_extra)` / `fn_notificar_paciente(tipo, paciente_id)` | Criam a notificação com a mensagem pronta |
| `fn_fixar_pilates(paciente_id, dia_semana, hora)` | Fixa uma turma (1 = segunda ... 5 = sexta) e reserva as aulas futuras dela |
| `fn_desfazer_fixo(fixo_id)` | Encerra o horário fixo e cancela as aulas futuras reservadas por ele |

Regras do pilates (no gatilho de agendamento): no máximo 2 aulas regulares por semana (segunda a domingo), em dias diferentes; reposição e aula experimental não contam. Cada aluno pode ter até 2 horários fixos, em dias diferentes. Quando a clínica abre uma aula de pilates, os alunos fixos daquela turma entram nela automaticamente (se houver vaga e não passar do limite da semana). Alta ou interrupção encerram os horários fixos.

A clínica funciona de segunda a sexta, menos nos feriados. O banco recusa horário e agendamento no sábado, no domingo ou em feriado (gatilhos `trg_horario_dia_util`, `trg_horario_nao_em_feriado` e `trg_a_agendamento_dia_aberto`).

## Feriados

A tabela `feriados` já vem com os feriados de 2026 a 2035:

- nacionais: 1º de janeiro, Paixão de Cristo (calculada pela Páscoa), 21 de abril, 1º de maio, 7 de setembro, 12 de outubro, 2, 15 e 20 de novembro, 25 de dezembro;
- de Pernambuco: 6 de março, Data Magna (Lei Estadual 16.241/2017).

São João (municipal), Carnaval e Corpus Christi (pontos facultativos) e os feriados da cidade a cliente acrescenta. `fn_adicionar_feriado(data, nome, tipo, por)` cadastra o feriado, cancela os atendimentos do dia e avisa cada paciente, sem remarcação (feriado não dá remarcação; para fechar um dia por outro motivo com remarcação, use `fn_cancelar_horarios`). `fn_gerar_feriados(ano)` cadastra os feriados fixos e a Paixão de Cristo de um ano novo.

Agendar é um `INSERT` em `agendamentos`: o gatilho `trg_valida_agendamento` recusa com uma mensagem clara quando falta vaga, o horário está bloqueado ou o paciente não pode agendar aquela modalidade. Para reposição ou remarcação liberada, informe `reposicao_de` (o novo horário precisa ser da mesma modalidade); para aula experimental, `experimental = true`.

## Views

- `vw_horarios_vagas` — horários com `vagas_restantes`, para a tela de agendamento.
- `vw_alerta_faltas_experimental` — pacientes com 2 ou mais faltas em aula experimental, com a observação pronta para a cliente.
- `vw_turmas_pilates` — turmas de pilates (dia da semana + hora) com aulas futuras abertas, para o aluno escolher o horário fixo.

## Instalar no Windows

Dê dois cliques em `instalar.bat`. Ele:

1. verifica se o PostgreSQL já está instalado e, se não estiver, instala o PostgreSQL 16 pelo winget (pede uma senha para o usuário `postgres`);
2. cria o banco `clinica`;
3. roda `001_schema.sql`, aplica as atualizações `003` a `019` e depois roda `002_testes.sql`.

Se o banco já existir, ele aplica só as atualizações que faltam e roda os testes. Para apagar e criar de novo: `powershell -ExecutionPolicy Bypass -File instalar.ps1 -Recriar`.
