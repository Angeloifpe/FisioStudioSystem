-- =============================================================================
-- Testes das regras de negócio
-- Roda tudo dentro de uma transação e desfaz no final (não deixa dados no banco).
-- Precisa que 001_schema.sql e as atualizações 003 a 015 já tenham sido aplicadas.
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 002_testes.sql
--
-- Cada teste imprime "OK - ..."; se uma regra falhar, o script para com erro.
-- =============================================================================

BEGIN;

-- Auxiliar: executa um comando e exige que ele falhe com a mensagem esperada
CREATE FUNCTION pg_temp.espera_erro(p_sql TEXT, p_msg TEXT, p_teste TEXT) RETURNS VOID AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_msg || '%' THEN
      RAISE EXCEPTION 'FALHOU - %: erro inesperado: %', p_teste, SQLERRM;
    END IF;
    RAISE NOTICE 'OK - %', p_teste;
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU - %: o comando deveria ter falhado', p_teste;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.confere(p_cond BOOLEAN, p_teste TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT p_cond THEN
    RAISE EXCEPTION 'FALHOU - %', p_teste;
  END IF;
  RAISE NOTICE 'OK - %', p_teste;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_admin UUID;
  v_p     UUID[] := '{}';
  v_u     UUID;
  v_id    UUID;
  i       INT;
  -- horários de teste
  -- data distante para não colidir com a agenda real (horários não podem se sobrepor)
  d       TIMESTAMPTZ := '2099-01-05 00:00:00-03';
  h_aval1 UUID; h_aval2 UUID; h_aval3 UUID;
  h_fisio UUID; h_pil1 UUID; h_pil2 UUID; h_pil3 UUID; h_pil4 UUID; h_pil5 UUID;
  h_bloq  UUID;
  a_exp1  UUID; a_exp2 UUID; a_aval UUID; a_pil UUID; a_futuro UUID;
  h_fisio2 UUID; h_fisio3 UUID; a_rem UUID; a_novo UUID; a_outro UUID;
  h_lote1 UUID; h_lote2 UUID; h_livre UUID; a_lote1 UUID; a_lote2 UUID; v_qtd INT;
  w UUID[]; h_seg UUID; v_fixo UUID; v_fixo2 UUID; h_novo UUID;
  h_fer UUID; a_fer UUID;
  v_p7 UUID; h_exp1 UUID; h_exp2 UUID; h_exp3 UUID; a_paga UUID; a_rem_paga UUID;
  v_p9 UUID; a_f1 UUID; a_f2 UUID;
  h_av UUID; h_av2 UUID; a_av UUID; a_av2 UUID; a_rep UUID;
  v_p10 UUID; h_a1 UUID; h_a2 UUID; h_a3 UUID; a_a UUID;
  v_p11 UUID; h_b1 UUID; h_b2 UUID; h_b3 UUID;
BEGIN
  -- Os testes antigos usam horários do dia inteiro: abre o funcionamento de
  -- segunda a sexta, 00h–24h. As faixas reais voltam na seção da 009.
  DELETE FROM funcionamento;
  INSERT INTO funcionamento (dia_semana, abre, fecha)
  SELECT g, '00:00', '23:59:59' FROM generate_series(1, 5) g;
  -- Idem para a grade de pilates (010): sem grade e sem a regra, até a seção da 010
  DELETE FROM pilates_grade;
  ALTER TABLE horarios DISABLE TRIGGER trg_horario_grade_pilates;
  -- Os testes antigos usam turmas de pilates de 4 vagas (012: padrão 8, ajustável)
  UPDATE config_clinica SET capacidade_padrao_pilates = 4;

  -- Cliente (admin)
  INSERT INTO usuarios (email, senha_hash, papel)
  VALUES ('teste.clinica@teste.invalid', 'hash', 'ADMIN') RETURNING id INTO v_admin;

  -- 6 pacientes
  FOR i IN 1..6 LOOP
    INSERT INTO usuarios (email, senha_hash, papel)
    VALUES ('teste.paciente' || i || '@teste.invalid', 'hash', 'PACIENTE') RETURNING id INTO v_u;
    INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone)
    VALUES (v_u, 'Paciente ' || i, '9999999990' || i, '1990-01-01', '81999990000')
    RETURNING id INTO v_id;
    v_p := v_p || v_id;
  END LOOP;

  PERFORM pg_temp.confere(
    (SELECT situacao FROM pacientes WHERE id = v_p[1]) = 'AGUARDANDO_AVALIACAO',
    'cadastro entra como AGUARDANDO_AVALIACAO sem aprovação');

  -- Horários
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', d + '08:00', d + '09:00') RETURNING id INTO h_aval1;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', d + '09:00', d + '10:00') RETURNING id INTO h_aval2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', d + '10:00', d + '11:00') RETURNING id INTO h_aval3;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', d + '11:00', d + '12:00') RETURNING id INTO h_fisio;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', d + '13:00', d + '14:00') RETURNING id INTO h_pil1;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', d + '14:00', d + '15:00') RETURNING id INTO h_pil2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', d + '15:00', d + '16:00') RETURNING id INTO h_pil3;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', d + '16:00', d + '17:00') RETURNING id INTO h_pil4;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', d + '17:00', d + '18:00') RETURNING id INTO h_pil5;
  INSERT INTO horarios (modalidade, inicio, fim, bloqueado) VALUES ('FISIOTERAPIA', d + '18:00', d + '19:00', TRUE) RETURNING id INTO h_bloq;

  PERFORM pg_temp.confere(
    (SELECT capacidade FROM horarios WHERE id = h_pil1) = 4
    AND (SELECT capacidade FROM horarios WHERE id = h_fisio) = 1,
    'pilates com 4 vagas e fisioterapia com 1');

  PERFORM pg_temp.espera_erro(
    format($q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', %L, %L)$q$,
           d + '08:30', d + '09:30'),
    'ex_horarios_sem_sobreposicao', 'horários sobrepostos são recusados');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[1], h_bloq),
    'Horário bloqueado', 'horário bloqueado não recebe agendamento');

  -- ---------------- Aula experimental ----------------
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (%L, %L, TRUE)', v_p[1], h_fisio),
    'só existe para pilates', 'aula experimental só em pilates');

  INSERT INTO agendamentos (paciente_id, horario_id, experimental)
  VALUES (v_p[1], h_pil1, TRUE) RETURNING id INTO a_exp1;
  RAISE NOTICE 'OK - paciente aguardando avaliação marca aula experimental';

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (%L, %L, TRUE)', v_p[1], h_pil2),
    'uq_aula_experimental_por_paciente', 'segunda aula experimental pendente é recusada');

  -- Imprevisto: faltou, pode marcar outra
  UPDATE agendamentos SET status = 'FALTA', presenca_registrada_em = now() WHERE id = a_exp1;
  INSERT INTO agendamentos (paciente_id, horario_id, experimental)
  VALUES (v_p[1], h_pil2, TRUE) RETURNING id INTO a_exp2;
  RAISE NOTICE 'OK - depois de faltar, paciente marca outra aula experimental';

  PERFORM pg_temp.confere(
    NOT EXISTS (SELECT 1 FROM vw_alerta_faltas_experimental WHERE paciente_id = v_p[1]),
    'uma falta em experimental ainda não gera alerta');

  UPDATE agendamentos SET status = 'FALTA', presenca_registrada_em = now() WHERE id = a_exp2;
  PERFORM pg_temp.confere(
    (SELECT faltas_experimentais FROM vw_alerta_faltas_experimental WHERE paciente_id = v_p[1]) = 2,
    'duas faltas em experimental geram alerta para a cliente');

  -- ---------------- Avaliação ----------------
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[1], h_fisio),
    'só para paciente liberado', 'fisioterapia antes da liberação é recusada');

  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[1], h_aval1) RETURNING id INTO a_aval;
  RAISE NOTICE 'OK - paciente agenda avaliação';

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[1], h_aval2),
    'avaliação pendente', 'segunda avaliação pendente é recusada');

  PERFORM fn_concluir_avaliacao(a_aval, 'LIBERADO', 'Apto para as duas modalidades', v_admin);
  PERFORM pg_temp.confere(
    (SELECT situacao FROM pacientes WHERE id = v_p[1]) = 'LIBERADO'
    AND (SELECT status FROM agendamentos WHERE id = a_aval) = 'REALIZADO',
    'concluir avaliação libera o paciente');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[1], h_aval2),
    'só para paciente aguardando avaliação', 'paciente liberado não agenda nova avaliação');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (%L, %L, TRUE)', v_p[1], h_pil3),
    'só para paciente aguardando avaliação', 'paciente liberado não marca aula experimental');

  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[1], h_fisio);
  RAISE NOTICE 'OK - paciente liberado agenda fisioterapia';

  -- ---------------- Vagas do pilates ----------------
  -- Libera os pacientes 2 a 6 para testar a turma
  FOR i IN 2..6 LOOP
    INSERT INTO agendamentos (paciente_id, horario_id)
    VALUES (v_p[i], CASE WHEN i % 2 = 0 THEN h_aval2 ELSE h_aval3 END) RETURNING id INTO v_id;
    PERFORM fn_concluir_avaliacao(v_id, 'LIBERADO', NULL, v_admin);
    -- libera o horário de avaliação para o próximo (fisioterapia/avaliação têm 1 vaga)
    UPDATE agendamentos SET status = 'CANCELADO' WHERE id = v_id;
  END LOOP;

  FOR i IN 2..5 LOOP
    INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[i], h_pil3);
  END LOOP;
  PERFORM pg_temp.confere(
    (SELECT vagas_restantes FROM vw_horarios_vagas WHERE id = h_pil3) = 0,
    'turma de pilates aceita 4 alunos');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[6], h_pil3),
    'Horário sem vagas', 'quinto aluno na turma é recusado');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[2], h_pil3),
    'Horário sem vagas', 'turma cheia recusa novo agendamento');

  -- ---------------- Cancelamento e reposição ----------------
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[6], h_pil4) RETURNING id INTO a_pil;

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (%L, %L, %L)', v_p[6], h_pil5, a_pil),
    'não liberada pela cliente', 'reposição sem cancelamento liberado é recusada');

  UPDATE agendamentos
     SET status = 'CANCELAMENTO_SOLICITADO', cancelamento_solicitado_em = now(),
         motivo_cancelamento = 'Viagem'
   WHERE id = a_pil;
  PERFORM fn_decidir_cancelamento(a_pil, TRUE, v_admin, TRUE);
  PERFORM pg_temp.confere(
    (SELECT status = 'CANCELADO' AND reposicao_liberada FROM agendamentos WHERE id = a_pil),
    'cliente aprova cancelamento e libera reposição');

  INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (v_p[6], h_pil5, a_pil);
  RAISE NOTICE 'OK - aluno marca a reposição';

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (%L, %L, %L)', v_p[6], h_pil1, a_pil),
    'uq_reposicao_usada_uma_vez', 'mesma reposição não é usada duas vezes');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (%L, %L, %L)', v_p[5], h_pil1, a_pil),
    'não liberada pela cliente', 'reposição de outro aluno é recusada');

  -- ---------------- Não liberado e reabertura ----------------
  -- Paciente 2: volta para avaliação (via reabertura não é permitida a partir de LIBERADO)
  PERFORM pg_temp.espera_erro(
    format($q$SELECT fn_mudar_situacao_paciente(%L, 'AGUARDANDO_AVALIACAO', NULL, %L)$q$, v_p[2], v_admin),
    'Só é possível reabrir', 'paciente liberado não é "reaberto"');

  -- Cria paciente 7 não liberado
  INSERT INTO usuarios (email, senha_hash, papel) VALUES ('teste.paciente7@teste.invalid', 'hash', 'PACIENTE') RETURNING id INTO v_u;
  INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone)
  VALUES (v_u, 'Paciente 7', '99999999907', '1985-05-05', '81999990007') RETURNING id INTO v_id;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_id, h_aval2) RETURNING id INTO a_aval;
  PERFORM fn_concluir_avaliacao(a_aval, 'NAO_LIBERADO', 'Precisa de liberação médica', v_admin);

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_id, h_aval3),
    'peça à clínica', 'não liberado não agenda nova avaliação');
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (%L, %L, TRUE)', v_id, h_pil1),
    'só para paciente aguardando avaliação', 'não liberado não marca aula experimental');

  PERFORM fn_mudar_situacao_paciente(v_id, 'AGUARDANDO_AVALIACAO', 'Trouxe liberação médica', v_admin);
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_id, h_aval3);
  PERFORM pg_temp.confere(
    (SELECT COUNT(*) FROM mudancas_situacao WHERE paciente_id = v_id) = 1,
    'cliente reabre e paciente agenda nova avaliação (mudança registrada)');

  -- ---------------- Alta ----------------
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[6], h_pil1) RETURNING id INTO a_futuro;
  PERFORM fn_mudar_situacao_paciente(v_p[6], 'ALTA', 'Tratamento concluído', v_admin);
  PERFORM pg_temp.confere(
    (SELECT status FROM agendamentos WHERE id = a_futuro) = 'CANCELADO',
    'alta cancela os agendamentos futuros');
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[6], h_pil2),
    'só para paciente liberado', 'paciente com alta não agenda');

  PERFORM fn_mudar_situacao_paciente(v_p[6], 'AGUARDANDO_AVALIACAO', 'Voltou', v_admin);
  PERFORM pg_temp.confere(
    (SELECT situacao FROM pacientes WHERE id = v_p[6]) = 'AGUARDANDO_AVALIACAO',
    'reabrir depois da alta leva a nova avaliação');

  -- ---------------- Ajustes da cliente (003_ajustes_cliente.sql) ----------------
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', d + '19:00', d + '20:00') RETURNING id INTO h_fisio2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', d + '20:00', d + '21:00') RETURNING id INTO h_fisio3;

  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[2], h_fisio2) RETURNING id INTO a_rem;

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_remarcar_agendamento(%L, %L, %L)', a_rem, h_pil2, v_admin),
    'mesma modalidade', 'remarcar só para a mesma modalidade');

  a_novo := fn_remarcar_agendamento(a_rem, h_fisio3, v_admin);
  PERFORM pg_temp.confere(
    (SELECT status FROM agendamentos WHERE id = a_rem) = 'CANCELADO'
    AND (SELECT remarcado_de FROM agendamentos WHERE id = a_novo) = a_rem
    AND (SELECT horario_id FROM agendamentos WHERE id = a_novo) = h_fisio3,
    'cliente remarca: antigo cancelado, novo ligado ao antigo');

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_remarcar_agendamento(%L, %L, %L)', a_rem, h_fisio2, v_admin),
    'já cancelado', 'agendamento já remarcado não é remarcado de novo');

  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[3], h_fisio2) RETURNING id INTO a_outro;
  PERFORM pg_temp.espera_erro(
    format('SELECT fn_remarcar_agendamento(%L, %L, %L)', a_outro, h_fisio3, v_admin),
    'Horário sem vagas', 'remarcar para horário cheio é recusado');
  PERFORM pg_temp.confere(
    (SELECT status FROM agendamentos WHERE id = a_outro) = 'AGENDADO',
    'remarcação recusada não mexe no agendamento original');

  PERFORM fn_cancelar_pela_clinica(a_outro, v_admin, 'Profissional indisponível');
  PERFORM pg_temp.confere(
    (SELECT status = 'CANCELADO' AND motivo_cancelamento = 'Profissional indisponível'
       FROM agendamentos WHERE id = a_outro),
    'cliente cancela um agendamento por conta própria');

  SELECT id INTO a_outro FROM agendamentos
   WHERE paciente_id = v_p[4] AND horario_id = h_pil3 AND status = 'AGENDADO';
  PERFORM fn_cancelar_pela_clinica(a_outro, v_admin, 'Aula suspensa', TRUE);
  PERFORM pg_temp.confere(
    (SELECT reposicao_liberada FROM agendamentos WHERE id = a_outro),
    'cliente cancela aula de pilates e libera reposição');

  -- ---------------- Notificações (004_notificacoes.sql) ----------------
  PERFORM fn_notificar_agendamento('REMARCADO_PELA_CLINICA', a_novo);
  PERFORM pg_temp.confere(
    (SELECT mensagem FROM notificacoes WHERE agendamento_id = a_novo AND destinatario = 'PACIENTE')
      = 'A clínica remarcou sua sessão de fisioterapia de 05/01 às 19:00 para 05/01 às 20:00.',
    'notificação de remarcação para o paciente');

  UPDATE agendamentos SET presenca_confirmada_em = now() WHERE id = a_novo;
  PERFORM fn_notificar_agendamento('PRESENCA_CONFIRMADA', a_novo);
  PERFORM pg_temp.confere(
    (SELECT mensagem FROM notificacoes WHERE agendamento_id = a_novo AND tipo = 'PRESENCA_CONFIRMADA')
      = 'Paciente 2 confirmou presença na sessão de fisioterapia de 05/01 às 20:00',
    'notificação de presença confirmada para a cliente');

  PERFORM fn_notificar_agendamento('CANCELADO_PELA_CLINICA', a_outro);
  PERFORM pg_temp.confere(
    (SELECT mensagem LIKE '%reposição foi liberada%' FROM notificacoes
      WHERE agendamento_id = a_outro AND tipo = 'CANCELADO_PELA_CLINICA'),
    'notificação de cancelamento avisa a reposição liberada');

  PERFORM fn_notificar_paciente('CADASTRO_NOVO', v_p[1]);
  PERFORM pg_temp.confere(
    EXISTS (SELECT 1 FROM notificacoes WHERE tipo = 'CADASTRO_NOVO' AND destinatario = 'ADMIN'
              AND mensagem = 'Paciente 1 se cadastrou e aguarda avaliação'),
    'notificação de cadastro novo para a cliente');

  -- ---------------- Cancelamento em lote (005_cancelamento_em_lote.sql) ----------------
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', d + INTERVAL '1 day' + '08:00', d + INTERVAL '1 day' + '09:00') RETURNING id INTO h_lote1;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES',      d + INTERVAL '1 day' + '09:00', d + INTERVAL '1 day' + '10:00') RETURNING id INTO h_lote2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', d + INTERVAL '2 day' + '08:00', d + INTERVAL '2 day' + '09:00') RETURNING id INTO h_livre;

  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[2], h_lote1) RETURNING id INTO a_lote1;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[3], h_lote2) RETURNING id INTO a_lote2;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[4], h_lote2);

  PERFORM pg_temp.espera_erro(
    format('SELECT * FROM fn_cancelar_horarios(ARRAY[%L]::uuid[], %L, %L)', h_lote1, v_admin, '  '),
    'Informe o motivo', 'cancelamento em lote exige motivo');

  SELECT COUNT(*) INTO v_qtd
    FROM fn_cancelar_horarios(ARRAY[h_lote1, h_lote2], v_admin, 'Fisioterapeuta em congresso.', TRUE, TRUE);
  PERFORM pg_temp.confere(v_qtd = 3, 'cancelamento em lote cancela os 3 atendimentos do dia');
  PERFORM pg_temp.confere(
    (SELECT bool_and(bloqueado) FROM horarios WHERE id IN (h_lote1, h_lote2)),
    'horários cancelados ficam bloqueados');
  PERFORM pg_temp.confere(
    (SELECT COUNT(*) FROM notificacoes WHERE tipo = 'CANCELADO_PELA_CLINICA'
        AND agendamento_id IN (SELECT id FROM agendamentos WHERE horario_id IN (h_lote1, h_lote2))
        AND mensagem LIKE '%Fisioterapeuta em congresso.%') = 3,
    'cada paciente recebe a mensagem personalizada da cliente');
  PERFORM pg_temp.confere(
    (SELECT mensagem FROM notificacoes WHERE agendamento_id = a_lote1)
      = 'A clínica cancelou sua sessão de fisioterapia de 06/01 às 08:00. Fisioterapeuta em congresso. A remarcação foi liberada: escolha um novo horário de fisioterapia.',
    'texto da notificação de cancelamento em lote');

  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (%L, %L, %L)', v_p[2], h_pil5, a_lote1),
    'não liberada', 'remarcação de fisioterapia não serve para pilates');
  INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (v_p[2], h_livre, a_lote1);
  RAISE NOTICE 'OK - paciente remarca a fisioterapia cancelada em outro horário';

  -- ---------------- Pilates: 2 por semana e horário fixo (006_pilates_semanal.sql) ----------------
  -- semana de teste: começa na segunda-feira 2099-01-12
  WITH novos AS (
    INSERT INTO horarios (modalidade, inicio, fim)
    SELECT 'PILATES', v.inicio, v.inicio + INTERVAL '1 hour'
      FROM (VALUES ('2099-01-12 07:00-03'::timestamptz), ('2099-01-12 08:00-03'),
                   ('2099-01-13 07:00-03'), ('2099-01-14 07:00-03')) v(inicio)
    RETURNING id, inicio
  )
  SELECT array_agg(id ORDER BY inicio) INTO w FROM novos;

  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[5], w[1]);
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[5], w[2]),
    'neste dia', 'duas aulas de pilates no mesmo dia são recusadas');
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[5], w[3]);
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[5], w[4]),
    'Limite de 2 aulas', 'terceira aula de pilates na semana é recusada');

  -- 016: ao fixar uma turma, as aulas avulsas saem e entra a aula da turma
  v_fixo := fn_fixar_pilates(v_p[5], fn_dia_semana('2099-01-12 08:00-03'), '08:00');
  PERFORM pg_temp.confere(
    NOT EXISTS (SELECT 1 FROM agendamentos WHERE paciente_id = v_p[5] AND horario_id IN (w[1], w[3]) AND status = 'AGENDADO')
    AND EXISTS (SELECT 1 FROM agendamentos WHERE paciente_id = v_p[5] AND horario_id = w[1]
                 AND status = 'CANCELADO' AND motivo_cancelamento = 'Substituída pelo horário fixo'),
    'fixar a turma cancela as aulas avulsas de pilates');
  PERFORM pg_temp.confere(
    EXISTS (SELECT 1 FROM agendamentos WHERE fixo_id = v_fixo AND horario_id = w[2] AND status = 'AGENDADO'),
    'no lugar da avulsa entra a aula da turma no mesmo dia');
  PERFORM fn_desfazer_fixo(v_fixo);

  -- Horário fixo: segunda às 07:00
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-01-19 07:00-03', '2099-01-19 08:00-03');
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-01-26 07:00-03', '2099-01-26 08:00-03');
  v_fixo := fn_fixar_pilates(v_p[3], fn_dia_semana('2099-01-12 07:00-03'), '07:00');
  PERFORM pg_temp.confere(
    (SELECT COUNT(*) FROM agendamentos WHERE fixo_id = v_fixo AND status = 'AGENDADO') = 3,
    'fixar a turma reserva as 3 aulas já abertas');

  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-02-02 07:00-03', '2099-02-02 08:00-03') RETURNING id INTO h_novo;
  PERFORM pg_temp.confere(
    EXISTS (SELECT 1 FROM agendamentos WHERE fixo_id = v_fixo AND horario_id = h_novo),
    'aula nova aberta pela clínica já entra com o aluno fixo');

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_fixar_pilates(%L, %s::smallint, %L)', v_p[3], fn_dia_semana('2099-01-12 07:00-03'), '08:00'),
    'neste dia da semana', 'dois fixos no mesmo dia da semana são recusados');

  v_fixo2 := fn_fixar_pilates(v_p[3], fn_dia_semana('2099-01-13 07:00-03'), '07:00');
  PERFORM pg_temp.espera_erro(
    format('SELECT fn_fixar_pilates(%L, %s::smallint, %L)', v_p[3], fn_dia_semana('2099-01-14 07:00-03'), '07:00'),
    'já tem 2 horários fixos', 'terceiro horário fixo é recusado');

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_fixar_pilates(%L, %s::smallint, %L)', v_p[4], 5, '23:00'),
    'não tem turma', 'fixar turma que não existe é recusado');
  PERFORM pg_temp.espera_erro(
    format('SELECT fn_fixar_pilates(%L, %s::smallint, %L)', v_p[4], 6, '07:00'),
    'segunda a sexta', 'fixar no sábado é recusado');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-01-17 09:00-03', '2099-01-17 10:00-03')$q$,
    'segunda a sexta', 'horário no sábado é recusado');

  PERFORM fn_notificar_fixo(v_fixo, 'ADMIN', 4);
  PERFORM pg_temp.confere(
    EXISTS (SELECT 1 FROM notificacoes WHERE tipo = 'HORARIO_FIXO_DEFINIDO' AND mensagem LIKE '%fixou o pilates nas segundas às 07:00%'),
    'notificação de horário fixo para a cliente');

  SELECT fn_desfazer_fixo(v_fixo) INTO v_qtd;
  PERFORM pg_temp.confere(
    v_qtd = 4 AND NOT (SELECT ativo FROM pilates_fixos WHERE id = v_fixo),
    'desfazer o fixo cancela as aulas futuras dele');

  PERFORM fn_mudar_situacao_paciente(v_p[3], 'ALTA', 'Concluiu', v_admin);
  PERFORM pg_temp.confere(
    NOT (SELECT ativo FROM pilates_fixos WHERE id = v_fixo2),
    'alta encerra os horários fixos');

  -- ---------------- Feriados (007_feriados.sql) ----------------
  PERFORM pg_temp.confere(fn_pascoa(2026) = '2026-04-05' AND fn_pascoa(2027) = '2027-03-28', 'cálculo da Páscoa');
  PERFORM pg_temp.confere(
    (SELECT nome FROM feriados WHERE data = '2026-04-03') = 'Paixão de Cristo'
    AND (SELECT tipo FROM feriados WHERE data = '2026-03-06') = 'ESTADUAL',
    'feriados nacionais e de Pernambuco cadastrados');

  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-01-21 10:00-03', '2099-01-21 11:00-03') RETURNING id INTO h_fer;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[4], h_fer) RETURNING id INTO a_fer;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-01-21 11:00-03', '2099-01-21 12:00-03');

  PERFORM pg_temp.confere(fn_adicionar_feriado('2099-01-21', 'Padroeiro da cidade', 'MUNICIPAL', v_admin) = 1,
    'cadastrar feriado cancela o atendimento do dia');
  PERFORM pg_temp.confere(
    (SELECT status = 'CANCELADO' AND NOT reposicao_liberada FROM agendamentos WHERE id = a_fer)
    AND (SELECT mensagem LIKE '%Feriado: Padroeiro da cidade.%' FROM notificacoes WHERE agendamento_id = a_fer AND tipo = 'CANCELADO_PELA_CLINICA'),
    'paciente avisado do feriado, sem remarcação');
  PERFORM pg_temp.confere(
    (SELECT COUNT(*) FROM horarios WHERE (inicio AT TIME ZONE 'America/Sao_Paulo')::date = '2099-01-21') = 1
    AND (SELECT bloqueado FROM horarios WHERE id = h_fer),
    'horário vazio do feriado apagado, o com histórico bloqueado');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-01-21 17:00-03', '2099-01-21 18:00-03')$q$,
    'feriado: Padroeiro', 'não abre horário em feriado');
  UPDATE horarios SET bloqueado = FALSE WHERE id = h_fer;
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[5], h_fer),
    'feriado: Padroeiro', 'não agenda em feriado nem com o horário desbloqueado');

  -- ---------------- Horário de funcionamento (009) ----------------
  DELETE FROM funcionamento;
  INSERT INTO funcionamento (dia_semana, abre, fecha) VALUES
    (1, '06:00', '11:00'), (1, '16:00', '19:10'),
    (2, '08:00', '11:00'), (2, '15:00', '17:10'),
    (3, '06:00', '11:00'),
    (4, '08:00', '11:00'), (4, '15:00', '17:10');

  -- semana de teste: segunda-feira 2099-03-02
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-02 06:00-03', '2099-03-02 07:00-03');
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-02 18:10-03', '2099-03-02 19:10-03');
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-03 16:10-03', '2099-03-03 17:10-03');
  RAISE NOTICE 'OK - horários dentro do funcionamento são aceitos (segunda cedo, segunda e terça à tarde)';

  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-06 08:00-03', '2099-03-06 09:00-03')$q$,
    'não abre na sexta-feira', 'sexta-feira fechada');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-04 15:00-03', '2099-03-04 16:00-03')$q$,
    'na quarta-feira a clínica atende das 06:00–11:00', 'quarta à tarde fechada');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-03-03 07:00-03', '2099-03-03 08:00-03')$q$,
    'Fora do horário de funcionamento', 'terça antes das 8h recusada');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-03-02 18:30-03', '2099-03-02 19:30-03')$q$,
    'Fora do horário de funcionamento', 'horário que passa do fechamento (19h10) recusado');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-03-02 10:30-03', '2099-03-02 16:30-03')$q$,
    'Fora do horário de funcionamento', 'horário que atravessa o intervalo do almoço recusado');

  -- Horário antigo fora do funcionamento não recebe agendamento novo
  ALTER TABLE horarios DISABLE TRIGGER trg_horario_funcionamento;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-03-05 12:00-03', '2099-03-05 13:00-03') RETURNING id INTO v_id;
  ALTER TABLE horarios ENABLE TRIGGER trg_horario_funcionamento;
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[2], v_id),
    'fora do horário de funcionamento', 'horário antigo fora do funcionamento não recebe agendamento');

  -- ---------------- Aula experimental paga (009) ----------------
  INSERT INTO usuarios (email, senha_hash, papel)
  VALUES ('teste.paciente8@teste.invalid', 'hash', 'PACIENTE') RETURNING id INTO v_u;
  INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone)
  VALUES (v_u, 'Paciente 8', '99999999908', '1990-01-01', '81999990000') RETURNING id INTO v_p7;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-09 06:00-03', '2099-03-09 07:00-03') RETURNING id INTO h_exp1;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-09 07:00-03', '2099-03-09 08:00-03') RETURNING id INTO h_exp2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-09 08:00-03', '2099-03-09 09:00-03') RETURNING id INTO h_exp3;

  -- Sem pagamento: pede para desmarcar e marca de novo
  INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (v_p7, h_exp1, TRUE) RETURNING id INTO a_paga;
  UPDATE agendamentos SET status = 'CANCELAMENTO_SOLICITADO', cancelamento_solicitado_em = now() WHERE id = a_paga;
  PERFORM fn_decidir_cancelamento(a_paga, TRUE, v_admin, FALSE);
  INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (v_p7, h_exp1, TRUE) RETURNING id INTO a_paga;
  RAISE NOTICE 'OK - experimental sem pagamento: desmarca e marca de novo';

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_registrar_pagamento_experimental(%L, %L, %L)', a_futuro, 'PIX', v_admin),
    'só vale para aula experimental', 'pagamento antecipado só para aula experimental');

  PERFORM fn_registrar_pagamento_experimental(a_paga, 'PIX', v_admin);
  PERFORM pg_temp.confere(
    (SELECT pago_em IS NOT NULL AND forma_pagamento = 'PIX' FROM agendamentos WHERE id = a_paga),
    'cliente registra o pagamento via Pix');
  PERFORM pg_temp.espera_erro(
    format('SELECT fn_registrar_pagamento_experimental(%L, %L, %L)', a_paga, 'APLICATIVO', v_admin),
    'já foi registrado', 'pagamento não é registrado duas vezes');

  PERFORM pg_temp.espera_erro(
    format($q$UPDATE agendamentos SET status = 'CANCELAMENTO_SOLICITADO' WHERE id = %L$q$, a_paga),
    'paga não pode ser desmarcada', 'experimental paga não pode ser desmarcada pelo paciente');

  -- Se a clínica remarca, o pagamento vai junto
  a_rem_paga := fn_remarcar_agendamento(a_paga, h_exp2, v_admin);
  PERFORM pg_temp.confere(
    (SELECT pago_em IS NOT NULL AND forma_pagamento = 'PIX' AND experimental FROM agendamentos WHERE id = a_rem_paga),
    'remarcação pela clínica mantém o pagamento');

  -- Paga e faltou: conta como dada, não marca outra
  UPDATE agendamentos SET status = 'FALTA', presenca_registrada_em = now() WHERE id = a_rem_paga;
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id, experimental) VALUES (%L, %L, TRUE)', v_p7, h_exp3),
    'uq_aula_experimental_por_paciente', 'experimental paga com falta conta como dada');

  -- ---------------- Grade de pilates e duração da fisioterapia (010) ----------------
  DELETE FROM funcionamento;
  INSERT INTO funcionamento (dia_semana, abre, fecha) VALUES
    (1, '06:00', '11:00'), (1, '16:00', '19:10'),
    (2, '08:00', '11:00'), (2, '15:00', '19:10'),
    (3, '06:00', '11:00'),
    (4, '08:00', '11:00'), (4, '15:00', '19:10');
  INSERT INTO pilates_grade (dia_semana, inicio, fim) VALUES
    (1, '06:00', '07:00'), (1, '08:00', '09:00'), (1, '09:00', '10:00'),
    (1, '16:00', '17:00'), (1, '17:10', '18:10'), (1, '18:10', '19:10'),
    (2, '08:00', '09:00'), (2, '09:00', '10:00'), (2, '15:00', '16:00'),
    (2, '16:00', '17:00'), (2, '17:10', '18:10'), (2, '18:10', '19:10'),
    (3, '06:00', '07:00'), (3, '08:00', '09:00'), (3, '09:00', '10:00'),
    (4, '08:30', '09:30'), (4, '09:30', '10:30'), (4, '15:00', '16:00'),
    (4, '16:00', '17:00'), (4, '17:10', '18:10'), (4, '18:10', '19:10');
  ALTER TABLE horarios ENABLE TRIGGER trg_horario_grade_pilates;

  -- semana de teste: segunda-feira 2099-03-16
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-16 08:00-03', '2099-03-16 09:00-03');
  RAISE NOTICE 'OK - aula de pilates da grade é aceita';
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', '2099-03-16 07:00-03', '2099-03-16 08:00-03')$q$,
    'fora da grade', 'aula de pilates fora da grade é recusada');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('FISIOTERAPIA', '2099-03-16 09:30-03', '2099-03-16 10:30-03')$q$,
    'tem aula de pilates (09:00 às 10:00)', 'fisioterapia no horário de aula da grade é recusada (mesmo com a aula fechada)');
  PERFORM pg_temp.espera_erro(
    $q$INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-03-17 15:30-03', '2099-03-17 16:00-03')$q$,
    'tem aula de pilates', 'avaliação no horário de aula da grade é recusada');

  -- Segunda: livre só 07:00–08:00 e 10:00–11:00 de manhã; à tarde só sobram 10 min (17:00–17:10)
  PERFORM pg_temp.confere(
    (SELECT array_agg(to_char(inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') ORDER BY inicio)
       FROM fn_inicios_fisioterapia('2099-03-16', 60)) = ARRAY['07:00', '10:00'],
    'inícios livres para sessão de 60 min respeitam a grade');
  PERFORM pg_temp.confere(
    (SELECT COUNT(*) FROM fn_inicios_fisioterapia('2099-03-16', 30)) = 8,
    'sessão de 30 min tem mais inícios livres (de 10 em 10 min)');
  PERFORM pg_temp.confere(
    NOT EXISTS (SELECT 1 FROM fn_inicios_fisioterapia('2099-03-20', 30)),
    'sexta-feira sem inícios livres');

  -- Paciente liberado com sessão de 30 min
  INSERT INTO usuarios (email, senha_hash, papel)
  VALUES ('teste.paciente9@teste.invalid', 'hash', 'PACIENTE') RETURNING id INTO v_u;
  INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone, situacao, liberado_pilates, liberado_fisioterapia)
  VALUES (v_u, 'Paciente 9', '99999999909', '1990-01-01', '81999990000', 'LIBERADO', TRUE, TRUE) RETURNING id INTO v_p9;
  PERFORM pg_temp.confere(
    (SELECT duracao_fisioterapia_min FROM pacientes WHERE id = v_p9) = 30,
    'paciente sem duração definida tem sessão de 30 min (011)');
  PERFORM pg_temp.espera_erro(
    format('UPDATE pacientes SET duracao_fisioterapia_min = 25 WHERE id = %L', v_p9),
    'ck_pacientes_duracao_fisio', 'duração da sessão abaixo de 30 min é recusada');
  PERFORM pg_temp.espera_erro(
    format('UPDATE pacientes SET duracao_fisioterapia_min = 90 WHERE id = %L', v_p9),
    'ck_pacientes_duracao_fisio', 'duração da sessão acima de 60 min é recusada');

  a_f1 := fn_agendar_fisioterapia(v_p9, '2099-03-16 07:00-03');
  PERFORM pg_temp.confere(
    (SELECT h.fim - h.inicio = INTERVAL '30 minutes' AND h.sob_demanda
       FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = a_f1),
    'fisioterapia criada com a duração do paciente (30 min)');
  PERFORM pg_temp.confere(
    (SELECT to_char(MIN(inicio) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') FROM fn_inicios_fisioterapia('2099-03-16', 30)) = '07:30',
    'o tempo ocupado sai dos inícios livres');
  PERFORM pg_temp.espera_erro(
    format($q$SELECT fn_agendar_fisioterapia(%L, '2099-03-16 08:30-03')$q$, v_p9),
    'tem aula de pilates', 'fisioterapia no horário da aula é recusada');
  PERFORM pg_temp.espera_erro(
    format($q$SELECT fn_agendar_fisioterapia(%L, '2099-03-16 07:20-03', 30)$q$, v_p[1]),
    'ex_horarios_sem_sobreposicao', 'fisioterapia que bate com outra é recusada');

  -- Cancelada, o tempo volta a ficar livre
  UPDATE agendamentos SET status = 'CANCELADO' WHERE id = a_f1;
  PERFORM pg_temp.confere(
    (SELECT h.cancelado FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = a_f1)
    AND (SELECT to_char(MIN(inicio) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') FROM fn_inicios_fisioterapia('2099-03-16', 30)) = '07:00',
    'cancelar a fisioterapia libera o horário');

  -- A cliente muda o início: mantém a duração e libera o horário antigo
  a_f1 := fn_agendar_fisioterapia(v_p9, '2099-03-16 07:00-03');
  a_f2 := fn_remarcar_fisioterapia(a_f1, '2099-03-16 10:15-03', v_admin);
  PERFORM pg_temp.confere(
    (SELECT to_char(h.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') = '10:15' AND h.fim - h.inicio = INTERVAL '30 minutes'
            AND a.remarcado_de = a_f1
       FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = a_f2)
    AND (SELECT h.cancelado FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = a_f1),
    'remarcar a fisioterapia pelo início mantém a duração e libera o horário antigo');

  -- Abrir as aulas da grade numa semana: 6 seg + 6 ter + 3 qua + 6 qui + 0 sex
  PERFORM pg_temp.confere(fn_abrir_aulas_pilates('2099-03-23', '2099-03-27') = 21,
    'abrir a grade de uma semana cria as 21 aulas');
  PERFORM pg_temp.confere(fn_abrir_aulas_pilates('2099-03-23', '2099-03-27') = 0,
    'abrir de novo não duplica aulas');

  -- ---------------- Capacidade das turmas (012) ----------------
  PERFORM pg_temp.confere(
    (SELECT capacidade FROM horarios WHERE modalidade = 'PILATES' AND inicio = '2099-03-16 08:00-03') = 8
    AND (SELECT capacidade FROM horarios WHERE id = (SELECT horario_id FROM agendamentos WHERE id = a_f2)) = 1,
    'aula da grade abre com 8 vagas; fisioterapia com 1');
  PERFORM pg_temp.espera_erro(
    $q$UPDATE horarios SET capacidade = 9 WHERE modalidade = 'PILATES' AND inicio = '2099-03-16 08:00-03'$q$,
    'ck_horarios_capacidade', 'turma com mais de 8 alunos é recusada');
  PERFORM pg_temp.espera_erro(
    format('UPDATE horarios SET capacidade = 2 WHERE id = %L', (SELECT horario_id FROM agendamentos WHERE id = a_f2)),
    'ck_horarios_capacidade', 'fisioterapia continua com 1 vaga');

  -- Turma de segunda 09:00 reduzida para 2 vagas, valendo nas aulas já abertas
  SELECT id INTO h_av FROM horarios WHERE modalidade = 'PILATES' AND inicio = '2099-03-23 09:00-03';
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p9, h_av) RETURNING id INTO a_av;
  SELECT COUNT(*) INTO v_qtd FROM fn_definir_capacidade_turma(1::smallint, '09:00', 2::smallint);
  PERFORM pg_temp.confere(
    v_qtd = 0
    AND (SELECT capacidade FROM pilates_grade WHERE dia_semana = 1 AND inicio = '09:00') = 2
    AND (SELECT capacidade FROM horarios WHERE id = h_av) = 2,
    'cliente muda a capacidade da turma e das aulas abertas');
  PERFORM pg_temp.confere(
    (SELECT capacidade FROM horarios WHERE modalidade = 'PILATES' AND inicio = '2099-03-23 08:00-03') = 8,
    'as outras turmas continuam com 8 vagas');
  UPDATE horarios SET capacidade = 1 WHERE id = h_av;
  PERFORM pg_temp.espera_erro(
    format('INSERT INTO agendamentos (paciente_id, horario_id) VALUES (%L, %L)', v_p[5], h_av),
    'sem vagas', 'aula com a capacidade reduzida num dia específico fica sem vagas');
  SELECT COUNT(*) INTO v_qtd FROM fn_definir_capacidade_turma(1::smallint, '09:00', 1::smallint);
  PERFORM pg_temp.confere(v_qtd = 0, 'reduzir para o número de alunos já agendados é aceito');
  UPDATE horarios SET capacidade = 2 WHERE id = h_av;
  UPDATE pacientes SET situacao = 'LIBERADO', liberado_pilates = TRUE WHERE id = v_p7;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p7, h_av);
  PERFORM pg_temp.espera_erro(
    format('UPDATE horarios SET capacidade = 1 WHERE id = %L', h_av),
    'já tem 2 alunos agendados', 'não reduz abaixo dos alunos agendados');

  -- ---------------- Aviso de falta no pilates (012) ----------------
  PERFORM pg_temp.confere(fn_avisar_falta_pilates(a_av, v_p9, 'Viagem'),
    'aviso de falta com antecedência gera remarcação');
  PERFORM pg_temp.confere(
    (SELECT status = 'CANCELADO' AND reposicao_liberada FROM agendamentos WHERE id = a_av)
    AND (SELECT vagas_restantes FROM vw_horarios_vagas WHERE id = h_av) = 1
    AND EXISTS (SELECT 1 FROM notificacoes WHERE agendamento_id = a_av AND tipo = 'FALTA_AVISADA' AND destinatario = 'ADMIN'),
    'a vaga daquele dia é liberada e a cliente é avisada');
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p[5], h_av);
  RAISE NOTICE 'OK - aluno de outra turma ocupa a vaga liberada';

  -- Remarcação em outra turma; desmarcar a reposição a tempo devolve o direito
  SELECT id INTO h_av2 FROM horarios WHERE modalidade = 'PILATES' AND inicio = '2099-03-24 16:00-03';
  INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (v_p9, h_av2, a_av) RETURNING id INTO a_rep;
  PERFORM pg_temp.confere(fn_avisar_falta_pilates(a_rep, v_p9), 'aviso na reposição com antecedência devolve a reposição');
  PERFORM pg_temp.confere((SELECT reposicao_liberada FROM agendamentos WHERE id = a_av)
    AND NOT (SELECT reposicao_liberada FROM agendamentos WHERE id = a_rep),
    'reposição desmarcada com 30 min ou mais devolve a reposição (018)');
  INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (v_p9, h_av2, a_av);
  RAISE NOTICE 'OK - a reposição desmarcada a tempo pode ser usada de novo';

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_avisar_falta_pilates(%L, %L)', a_rem_paga, v_p7),
    'pilates regular', 'aviso de falta não vale para aula experimental');

  -- Menos de 30 minutos antes (013): cancela e libera a vaga, mas sem remarcação
  ALTER TABLE horarios DISABLE TRIGGER USER;
  ALTER TABLE agendamentos DISABLE TRIGGER USER;
  INSERT INTO horarios (modalidade, inicio, fim, capacidade) VALUES ('PILATES', now() + INTERVAL '20 minutes', now() + INTERVAL '80 minutes', 8) RETURNING id INTO v_id;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p9, v_id) RETURNING id INTO a_av2;
  INSERT INTO horarios (modalidade, inicio, fim, capacidade) VALUES ('PILATES', now() - INTERVAL '10 minutes', now() + INTERVAL '5 minutes', 8) RETURNING id INTO h_av2;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p9, h_av2) RETURNING id INTO a_rep;
  INSERT INTO horarios (modalidade, inicio, fim, capacidade) VALUES ('PILATES', now() - INTERVAL '90 minutes', now() - INTERVAL '30 minutes', 8) RETURNING id INTO h_av;
  INSERT INTO agendamentos (paciente_id, horario_id) VALUES (v_p9, h_av) RETURNING id INTO a_av;
  ALTER TABLE horarios ENABLE TRIGGER USER;
  ALTER TABLE agendamentos ENABLE TRIGGER USER;
  PERFORM pg_temp.confere(
    NOT fn_avisar_falta_pilates(a_av2, v_p9),
    'aviso com menos de 30 minutos é aceito, sem remarcação');
  PERFORM pg_temp.confere(
    (SELECT status = 'CANCELADO' AND NOT reposicao_liberada AND motivo_cancelamento LIKE '%conta como dada%'
       FROM agendamentos WHERE id = a_av2)
    AND (SELECT mensagem LIKE '%conta como dada%' FROM notificacoes WHERE agendamento_id = a_av2),
    'aula avisada em cima da hora fica cancelada como dada e a cliente é avisada');
  PERFORM pg_temp.confere(NOT fn_avisar_falta_pilates(a_rep, v_p9),
    'aula em andamento ainda pode ser avisada (sem remarcação)');

  PERFORM pg_temp.espera_erro(
    format('SELECT fn_avisar_falta_pilates(%L, %L)', a_av, v_p9),
    'já terminou', 'aula que já terminou não pode ser avisada');

  -- 018: reposição desmarcada com menos de 30 min conta como dada (a reposição é gasta)
  ALTER TABLE horarios DISABLE TRIGGER USER;
  ALTER TABLE agendamentos DISABLE TRIGGER USER;
  INSERT INTO horarios (modalidade, inicio, fim, capacidade) VALUES ('PILATES', now() - INTERVAL '3 days', now() - INTERVAL '3 days' + INTERVAL '1 hour', 8) RETURNING id INTO h_av;
  INSERT INTO agendamentos (paciente_id, horario_id, status, reposicao_liberada) VALUES (v_p9, h_av, 'CANCELADO', TRUE) RETURNING id INTO a_av;
  INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de) VALUES (v_p9, v_id, a_av) RETURNING id INTO a_rep;
  ALTER TABLE horarios ENABLE TRIGGER USER;
  ALTER TABLE agendamentos ENABLE TRIGGER USER;
  PERFORM pg_temp.confere(NOT fn_avisar_falta_pilates(a_rep, v_p9), 'reposição desmarcada em cima da hora não devolve a reposição (018)');
  PERFORM pg_temp.confere(NOT (SELECT reposicao_liberada FROM agendamentos WHERE id = a_av)
    AND (SELECT status = 'CANCELADO' AND motivo_cancelamento LIKE '%conta como dada%' FROM agendamentos WHERE id = a_rep),
    'reposição desmarcada com menos de 30 min conta como dada e não volta (018)');

  -- ---------------- Avaliação por modalidade (014) ----------------
  INSERT INTO usuarios (email, senha_hash, papel)
  VALUES ('teste.paciente10@teste.invalid', 'hash', 'PACIENTE') RETURNING id INTO v_u;
  INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone)
  VALUES (v_u, 'Paciente 10', '99999999910', '1990-01-01', '81999990000') RETURNING id INTO v_p10;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-03-30 07:00-03', '2099-03-30 08:00-03') RETURNING id INTO h_a1;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-03-30 10:00-03', '2099-03-30 11:00-03') RETURNING id INTO h_a2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-04-01 07:00-03', '2099-04-01 08:00-03') RETURNING id INTO h_a3;

  -- Avaliação de pilates: liberado só para o pilates
  INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (v_p10, h_a1, 'PILATES') RETURNING id INTO a_a;
  PERFORM pg_temp.espera_erro(
    format($q$SELECT fn_concluir_avaliacao(%L, 'LIBERADO', NULL, %L, 'FISIOTERAPIA')$q$, a_a, v_admin),
    'só dá para liberar essa modalidade', 'avaliação de pilates não libera fisioterapia');
  PERFORM fn_concluir_avaliacao(a_a, 'LIBERADO', 'Indicado pilates', v_admin);
  PERFORM pg_temp.confere(
    (SELECT situacao = 'LIBERADO' AND liberado_pilates AND NOT liberado_fisioterapia FROM pacientes WHERE id = v_p10)
    AND (SELECT avaliacao_para = 'PILATES' AND liberado_para = 'PILATES' FROM avaliacoes WHERE agendamento_id = a_a),
    'avaliação de pilates libera só o pilates');
  INSERT INTO agendamentos (paciente_id, horario_id)
  SELECT v_p10, id FROM horarios WHERE modalidade = 'PILATES' AND inicio = '2099-03-25 08:00-03';
  RAISE NOTICE 'OK - liberado para o pilates agenda aula de pilates';
  PERFORM pg_temp.espera_erro(
    format($q$SELECT fn_agendar_fisioterapia(%L, '2099-03-31 10:00-03', 30)$q$, v_p10),
    'não foi liberado para a fisioterapia', 'liberado só para o pilates não agenda fisioterapia');
  PERFORM pg_temp.espera_erro(
    format($q$INSERT INTO agendamentos (paciente_id, horario_id, experimental)
              SELECT %L, id, TRUE FROM horarios WHERE modalidade = 'PILATES' AND inicio = '2099-03-26 08:30-03'$q$, v_p10),
    'aguardando avaliação de pilates', 'liberado para o pilates não marca aula experimental');
  PERFORM pg_temp.espera_erro(
    format($q$INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (%L, %L, 'PILATES')$q$, v_p10, h_a2),
    'já está liberado para o pilates', 'não pede de novo a avaliação de pilates');

  -- Avaliação de fisioterapia sem liberação: continua liberado para o pilates
  INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (v_p10, h_a2, 'FISIOTERAPIA') RETURNING id INTO a_a;
  RAISE NOTICE 'OK - liberado para o pilates pede a avaliação de fisioterapia';
  PERFORM fn_concluir_avaliacao(a_a, 'NAO_LIBERADO', NULL, v_admin);
  PERFORM pg_temp.confere(
    (SELECT situacao = 'LIBERADO' AND liberado_pilates AND NOT liberado_fisioterapia FROM pacientes WHERE id = v_p10),
    'não liberado na fisioterapia continua liberado para o pilates');
  PERFORM fn_notificar_agendamento('AVALIACAO_CONCLUIDA', a_a);
  PERFORM pg_temp.confere(
    (SELECT mensagem LIKE '%continua liberado para pilates%' FROM notificacoes WHERE agendamento_id = a_a AND tipo = 'AVALIACAO_CONCLUIDA'),
    'aviso da avaliação diz que continua liberado para o pilates');

  -- Nova avaliação de fisioterapia, liberada pela clínica (019): fica com as duas
  PERFORM fn_liberar_nova_avaliacao(v_p10, v_admin);
  INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (v_p10, h_a3, 'FISIOTERAPIA') RETURNING id INTO a_a;
  PERFORM fn_concluir_avaliacao(a_a, 'LIBERADO', NULL, v_admin);
  PERFORM pg_temp.confere(
    (SELECT liberado_pilates AND liberado_fisioterapia FROM pacientes WHERE id = v_p10),
    'com as duas avaliações fica liberado para as duas modalidades');
  PERFORM fn_agendar_fisioterapia(v_p10, '2099-03-31 10:00-03', 30);
  RAISE NOTICE 'OK - liberado para as duas agenda fisioterapia';

  -- Reabrir o cadastro zera as liberações
  PERFORM fn_mudar_situacao_paciente(v_p10, 'ALTA', 'Teste', v_admin);
  PERFORM fn_mudar_situacao_paciente(v_p10, 'AGUARDANDO_AVALIACAO', 'Voltou', v_admin);
  PERFORM pg_temp.confere(
    (SELECT NOT liberado_pilates AND NOT liberado_fisioterapia FROM pacientes WHERE id = v_p10),
    'reabrir o cadastro zera as liberações');

  -- ---------------- Avaliações separadas (015) ----------------
  INSERT INTO usuarios (email, senha_hash, papel)
  VALUES ('teste.paciente11@teste.invalid', 'hash', 'PACIENTE') RETURNING id INTO v_u;
  INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone)
  VALUES (v_u, 'Paciente 11', '99999999911', '1990-01-01', '81999990000') RETURNING id INTO v_p11;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-04-06 07:00-03', '2099-04-06 08:00-03') RETURNING id INTO h_b1;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-04-06 10:00-03', '2099-04-06 11:00-03') RETURNING id INTO h_b2;
  INSERT INTO horarios (modalidade, inicio, fim) VALUES ('AVALIACAO', '2099-04-08 07:00-03', '2099-04-08 08:00-03') RETURNING id INTO h_b3;

  INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (v_p11, h_b1, 'PILATES');
  INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (v_p11, h_b2, 'FISIOTERAPIA');
  RAISE NOTICE 'OK - avaliação de pilates e de fisioterapia marcadas ao mesmo tempo';
  PERFORM pg_temp.espera_erro(
    format($q$INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (%L, %L, 'PILATES')$q$, v_p11, h_b3),
    'avaliação pendente de pilates', 'segunda avaliação de pilates pendente é recusada');

  -- 019: liberado no pilates e não liberado na fisioterapia: nova avaliação só com a clínica
  PERFORM fn_concluir_avaliacao((SELECT id FROM agendamentos WHERE paciente_id = v_p11 AND horario_id = h_b1), 'LIBERADO', NULL, v_admin);
  PERFORM fn_concluir_avaliacao((SELECT id FROM agendamentos WHERE paciente_id = v_p11 AND horario_id = h_b2), 'NAO_LIBERADO', NULL, v_admin);
  PERFORM pg_temp.confere(
    (SELECT situacao = 'LIBERADO' AND liberado_pilates AND nova_avaliacao_bloqueada FROM pacientes WHERE id = v_p11),
    'não liberado na fisioterapia: continua no pilates e fica sem nova avaliação');
  PERFORM pg_temp.espera_erro(
    format($q$INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (%L, %L, 'FISIOTERAPIA')$q$, v_p11, h_b3),
    'peça à clínica', 'nova avaliação sem liberação da clínica é recusada');
  PERFORM fn_pedir_nova_avaliacao(v_p11);
  PERFORM pg_temp.confere(
    EXISTS (SELECT 1 FROM notificacoes WHERE paciente_id = v_p11 AND tipo = 'NOVA_AVALIACAO_PEDIDA' AND destinatario = 'ADMIN'),
    'paciente pede nova avaliação e a cliente é avisada');
  PERFORM pg_temp.espera_erro(format('SELECT fn_pedir_nova_avaliacao(%L)', v_p11), 'já pediu', 'pedido repetido é recusado');
  PERFORM fn_liberar_nova_avaliacao(v_p11, v_admin);
  INSERT INTO agendamentos (paciente_id, horario_id, avaliacao_para) VALUES (v_p11, h_b3, 'FISIOTERAPIA');
  PERFORM pg_temp.confere(
    (SELECT situacao = 'LIBERADO' AND liberado_pilates AND NOT nova_avaliacao_bloqueada FROM pacientes WHERE id = v_p11)
    AND EXISTS (SELECT 1 FROM notificacoes WHERE paciente_id = v_p11 AND tipo = 'NOVA_AVALIACAO_LIBERADA'),
    'clínica libera: paciente marca a nova avaliação e continua no pilates');

  -- ---------------- Registro de atendimento ----------------
  INSERT INTO registros_atendimento (paciente_id, data_atendimento, observacoes, criado_por)
  VALUES (v_p[1], current_date, 'Atendido fora do horário marcado', v_admin);
  RAISE NOTICE 'OK - registro de fisioterapia sem agendamento';

  RAISE NOTICE '=== Todos os testes passaram ===';
END $$;

ROLLBACK;
