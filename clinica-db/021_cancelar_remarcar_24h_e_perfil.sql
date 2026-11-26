-- =============================================================================
-- 021 — Cancelar e remarcar com 24 h de antecedência, sessão de 1 hora e foto
--       de perfil
--
--   1. Prazo para cancelar/remarcar: 24 h (antes eram 30 min). A cliente ainda
--      pode mudar em config_clinica.antecedencia_aviso_falta_min.
--   2. O paciente cancela sozinho (fisioterapia, avaliação, aula experimental
--      sem pagamento), sem esperar a decisão da cliente:
--        - no prazo: cancelado, sem cobrança;
--        - fora do prazo: cancelado e a consulta é cobrada.
--      Cada cancelamento guarda se foi feito dentro ou fora do prazo
--      (agendamentos.cancelado_fora_do_prazo) e avisa a cliente.
--   3. O paciente remarca sozinho (fisioterapia, avaliação, aula experimental):
--      a consulta antiga é cancelada e a nova fica ligada a ela (remarcado_de).
--      Remarcar fora do prazo não tira a cobrança da consulta antiga.
--   4. Sessão de fisioterapia padrão de 1 hora.
--   5. Foto de perfil (usuarios.foto_perfil).
-- =============================================================================

BEGIN;

-- 1. Prazo de 24 h --------------------------------------------------------------
ALTER TABLE config_clinica ALTER COLUMN antecedencia_aviso_falta_min SET DEFAULT 1440;
UPDATE config_clinica SET antecedencia_aviso_falta_min = 1440;

-- 2. Marca de cancelamento fora do prazo -----------------------------------------
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS cancelado_fora_do_prazo BOOLEAN;
COMMENT ON COLUMN agendamentos.cancelado_fora_do_prazo IS
  'Cancelamento feito pelo paciente: FALSE = dentro do prazo (sem cobrança); TRUE = fora do prazo (consulta cobrada); vazio = não foi cancelamento do paciente.';

-- Texto do prazo para as mensagens ("24 h", "30 min")
CREATE OR REPLACE FUNCTION fn_texto_prazo(p_minutos INTEGER) RETURNS TEXT AS $$
  SELECT CASE WHEN p_minutos >= 60 AND p_minutos % 60 = 0 THEN (p_minutos / 60) || ' h'
              ELSE p_minutos || ' min' END;
$$ LANGUAGE sql IMMUTABLE;

-- Aviso de falta no pilates: igual à 018, agora guardando se foi fora do prazo
CREATE OR REPLACE FUNCTION fn_avisar_falta_pilates(
  p_agendamento_id UUID,
  p_paciente_id    UUID,
  p_motivo         TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_ag           agendamentos%ROWTYPE;
  v_inicio       TIMESTAMPTZ;
  v_fim          TIMESTAMPTZ;
  v_modalidade   modalidade;
  v_antecedencia INTEGER;
  v_no_prazo     BOOLEAN;
  v_nome         TEXT;
  v_remarcacao   BOOLEAN;
BEGIN
  SELECT a.* INTO v_ag FROM agendamentos a
   WHERE a.id = p_agendamento_id AND a.paciente_id = p_paciente_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  SELECT h.inicio, h.fim, h.modalidade INTO v_inicio, v_fim, v_modalidade FROM horarios h WHERE h.id = v_ag.horario_id;
  IF v_modalidade <> 'PILATES' OR v_ag.experimental THEN
    RAISE EXCEPTION 'O aviso de falta com remarcação vale para aula de pilates regular';
  END IF;
  IF v_ag.status <> 'AGENDADO' THEN
    RAISE EXCEPTION 'Esta aula não está mais agendada';
  END IF;
  IF v_fim <= now() THEN
    RAISE EXCEPTION 'Esta aula já terminou';
  END IF;

  SELECT antecedencia_aviso_falta_min INTO v_antecedencia FROM config_clinica;
  v_no_prazo := v_inicio - now() >= make_interval(mins => v_antecedencia);

  v_remarcacao := v_no_prazo;
  IF v_ag.reposicao_de IS NOT NULL AND NOT v_no_prazo THEN
    UPDATE agendamentos SET reposicao_liberada = FALSE WHERE id = v_ag.reposicao_de;
  END IF;

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_solicitado_em = now(),
         cancelado_fora_do_prazo = NOT v_no_prazo,
         motivo_cancelamento = COALESCE(NULLIF(trim(p_motivo), ''),
                                        CASE WHEN v_no_prazo THEN 'Aluno avisou que não vai'
                                             ELSE 'Aluno avisou em cima da hora: aula conta como dada' END),
         reposicao_liberada = v_no_prazo AND v_ag.reposicao_de IS NULL
   WHERE id = p_agendamento_id;

  SELECT nome_completo INTO v_nome FROM pacientes WHERE id = p_paciente_id;
  INSERT INTO notificacoes (destinatario, paciente_id, agendamento_id, tipo, mensagem)
  VALUES ('ADMIN', p_paciente_id, p_agendamento_id, 'FALTA_AVISADA',
          format('%s avisou que não vai à %s. A vaga foi liberada%s.',
                 v_nome, fn_descrever_agendamento(p_agendamento_id),
                 CASE WHEN v_remarcacao THEN ' e o aluno pode remarcar'
                      WHEN NOT v_no_prazo THEN format(' (aviso com menos de %s: a aula conta como dada)', fn_texto_prazo(v_antecedencia))
                      ELSE '' END));

  RETURN v_remarcacao;
END;
$$ LANGUAGE plpgsql;

-- 3. O paciente cancela sozinho (fisioterapia, avaliação, experimental) -----------
-- Devolve TRUE se o cancelamento foi dentro do prazo (sem cobrança).
CREATE OR REPLACE FUNCTION fn_cancelar_pelo_paciente(
  p_agendamento_id UUID,
  p_paciente_id    UUID,
  p_motivo         TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_ag           agendamentos%ROWTYPE;
  v_inicio       TIMESTAMPTZ;
  v_fim          TIMESTAMPTZ;
  v_modalidade   modalidade;
  v_antecedencia INTEGER;
  v_no_prazo     BOOLEAN;
  v_nome         TEXT;
BEGIN
  SELECT a.* INTO v_ag FROM agendamentos a
   WHERE a.id = p_agendamento_id AND a.paciente_id = p_paciente_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  SELECT h.inicio, h.fim, h.modalidade INTO v_inicio, v_fim, v_modalidade FROM horarios h WHERE h.id = v_ag.horario_id;
  IF v_modalidade = 'PILATES' AND NOT v_ag.experimental THEN
    RAISE EXCEPTION 'Aula de pilates é cancelada pelo aviso de falta';
  END IF;
  IF v_ag.status <> 'AGENDADO' THEN
    RAISE EXCEPTION 'Este atendimento não está mais agendado';
  END IF;
  IF v_fim <= now() THEN
    RAISE EXCEPTION 'Este atendimento já terminou';
  END IF;
  IF v_ag.experimental AND v_ag.pago_em IS NOT NULL THEN
    RAISE EXCEPTION 'Aula experimental paga não pode ser desmarcada';
  END IF;

  SELECT antecedencia_aviso_falta_min INTO v_antecedencia FROM config_clinica;
  v_no_prazo := v_inicio - now() >= make_interval(mins => v_antecedencia);

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_solicitado_em = now(),
         cancelado_fora_do_prazo = NOT v_no_prazo,
         motivo_cancelamento = COALESCE(NULLIF(trim(p_motivo), ''),
                                        CASE WHEN v_no_prazo THEN 'Cancelado pelo paciente'
                                             ELSE 'Cancelado pelo paciente fora do prazo' END),
         reposicao_liberada = FALSE
   WHERE id = p_agendamento_id;

  SELECT nome_completo INTO v_nome FROM pacientes WHERE id = p_paciente_id;
  INSERT INTO notificacoes (destinatario, paciente_id, agendamento_id, tipo, mensagem)
  VALUES ('ADMIN', p_paciente_id, p_agendamento_id, 'FALTA_AVISADA',
          format('%s cancelou a %s %s.', v_nome, fn_descrever_agendamento(p_agendamento_id),
                 CASE WHEN v_no_prazo THEN '(dentro do prazo, sem cobrança)'
                      ELSE format('(fora do prazo de %s: a consulta será cobrada)', fn_texto_prazo(v_antecedencia)) END));

  RETURN v_no_prazo;
END;
$$ LANGUAGE plpgsql;

-- 4. O paciente remarca sozinho ------------------------------------------------
--   p_novo_inicio: só fisioterapia, início livre (o horário é criado)
--   p_novo_horario_id: um horário aberto (avaliação, aula experimental, fisioterapia)
--   aula de pilates regular não entra aqui: cancele com o aviso de falta (a
--   remarcação vira um crédito) e use a remarcação.
-- Devolve o id do novo agendamento.
CREATE OR REPLACE FUNCTION fn_remarcar_pelo_paciente(
  p_agendamento_id  UUID,
  p_paciente_id     UUID,
  p_novo_horario_id UUID DEFAULT NULL,
  p_novo_inicio     TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_ag           agendamentos%ROWTYPE;
  v_h            horarios%ROWTYPE;
  v_nova_mod     modalidade;
  v_novo_inicio  TIMESTAMPTZ;
  v_antecedencia INTEGER;
  v_no_prazo     BOOLEAN;
  v_duracao      INTEGER;
  v_novo_id      UUID;
  v_nome         TEXT;
BEGIN
  SELECT a.* INTO v_ag FROM agendamentos a
   WHERE a.id = p_agendamento_id AND a.paciente_id = p_paciente_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;
  SELECT * INTO v_h FROM horarios WHERE id = v_ag.horario_id;

  IF v_ag.status <> 'AGENDADO' THEN
    RAISE EXCEPTION 'Este atendimento não está mais agendado';
  END IF;
  IF v_h.fim <= now() THEN
    RAISE EXCEPTION 'Este atendimento já terminou';
  END IF;
  IF v_h.modalidade = 'PILATES' AND NOT v_ag.experimental THEN
    RAISE EXCEPTION 'No pilates, avise a falta com antecedência para ganhar a remarcação';
  END IF;
  IF v_ag.experimental AND v_ag.pago_em IS NOT NULL THEN
    RAISE EXCEPTION 'Aula experimental paga não pode ser remarcada';
  END IF;

  IF p_novo_inicio IS NOT NULL THEN
    -- início livre: só a fisioterapia (o horário é criado com a mesma duração)
    IF v_h.modalidade <> 'FISIOTERAPIA' THEN
      RAISE EXCEPTION 'Só a fisioterapia é remarcada pelo início; nas outras escolha um horário aberto';
    END IF;
    v_novo_inicio := p_novo_inicio;
  ELSE
    IF p_novo_horario_id IS NULL THEN RAISE EXCEPTION 'Escolha o novo horário'; END IF;
    IF p_novo_horario_id = v_ag.horario_id THEN RAISE EXCEPTION 'O novo horário é igual ao atual'; END IF;
    SELECT modalidade, inicio INTO v_nova_mod, v_novo_inicio FROM horarios WHERE id = p_novo_horario_id;
    IF v_nova_mod IS NULL THEN RAISE EXCEPTION 'Novo horário não encontrado'; END IF;
    IF v_nova_mod <> v_h.modalidade THEN RAISE EXCEPTION 'Só é possível remarcar para um horário da mesma modalidade'; END IF;
  END IF;
  IF v_novo_inicio <= now() THEN
    RAISE EXCEPTION 'O novo horário já passou';
  END IF;

  SELECT antecedencia_aviso_falta_min INTO v_antecedencia FROM config_clinica;
  v_no_prazo := v_h.inicio - now() >= make_interval(mins => v_antecedencia);
  v_duracao := extract(epoch FROM v_h.fim - v_h.inicio)::INTEGER / 60;

  -- Cancela primeiro: o horário (ou o tempo sob demanda) volta a ficar livre
  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_solicitado_em = now(),
         cancelado_fora_do_prazo = NOT v_no_prazo,
         motivo_cancelamento = CASE WHEN v_no_prazo THEN 'Remarcado pelo paciente'
                                    ELSE 'Remarcado pelo paciente fora do prazo' END,
         reposicao_liberada = FALSE
   WHERE id = p_agendamento_id;

  IF p_novo_inicio IS NOT NULL THEN
    v_novo_id := fn_agendar_fisioterapia(p_paciente_id, v_novo_inicio, v_duracao, NULL, p_agendamento_id);
  ELSE
    -- O gatilho trg_valida_agendamento confere vagas, bloqueio e situação
    INSERT INTO agendamentos (paciente_id, horario_id, experimental, avaliacao_para, remarcado_de)
    VALUES (p_paciente_id, p_novo_horario_id, v_ag.experimental, v_ag.avaliacao_para, p_agendamento_id)
    RETURNING id INTO v_novo_id;
  END IF;

  SELECT nome_completo INTO v_nome FROM pacientes WHERE id = p_paciente_id;
  INSERT INTO notificacoes (destinatario, paciente_id, agendamento_id, tipo, mensagem)
  VALUES ('ADMIN', p_paciente_id, v_novo_id, 'REPOSICAO_MARCADA',
          format('%s remarcou a %s para %s %s.', v_nome, fn_descrever_agendamento(p_agendamento_id),
                 fn_descrever_agendamento(v_novo_id),
                 CASE WHEN v_no_prazo THEN '(dentro do prazo, sem cobrança)'
                      ELSE format('(fora do prazo de %s: a consulta antiga será cobrada)', fn_texto_prazo(v_antecedencia)) END));

  RETURN v_novo_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Sessão de fisioterapia de 1 hora -------------------------------------------
ALTER TABLE pacientes ALTER COLUMN duracao_fisioterapia_min SET DEFAULT 60;
UPDATE pacientes SET duracao_fisioterapia_min = 60 WHERE duracao_fisioterapia_min = 30;

-- 6. Foto de perfil -------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil TEXT
  CHECK (foto_perfil IS NULL OR (foto_perfil ~ '^data:image/(jpeg|png|webp);base64,' AND length(foto_perfil) <= 500000));
COMMENT ON COLUMN usuarios.foto_perfil IS 'Foto de perfil como data URL (jpeg, png ou webp), até ~370 KB.';

COMMIT;
