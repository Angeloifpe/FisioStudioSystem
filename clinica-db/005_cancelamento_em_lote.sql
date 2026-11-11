-- =============================================================================
-- 005 — Cancelamento em lote pela cliente
--   - cancelar todos os atendimentos de um dia ou de horários escolhidos
--   - mensagem personalizada da cliente na notificação (o motivo)
--   - liberar remarcação: o paciente remarca sozinho para um horário da
--     mesma modalidade (fisioterapia, pilates ou avaliação)
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 005_cancelamento_em_lote.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Gatilho de agendamento: a reposição/remarcação deixa de ser só do pilates.
-- Vale para a mesma modalidade da aula/sessão cancelada e liberada.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_agendamento() RETURNS TRIGGER AS $$
DECLARE
  v_modalidade modalidade;
  v_capacidade SMALLINT;
  v_bloqueado  BOOLEAN;
  v_ocupadas   INTEGER;
  v_situacao   situacao_paciente;
BEGIN
  -- Trava o horário para que agendamentos simultâneos não estourem as vagas
  SELECT modalidade, capacidade, bloqueado
    INTO v_modalidade, v_capacidade, v_bloqueado
    FROM horarios
   WHERE id = NEW.horario_id
     FOR UPDATE;

  IF v_bloqueado THEN
    RAISE EXCEPTION 'Horário bloqueado';
  END IF;

  SELECT COUNT(*) INTO v_ocupadas
    FROM agendamentos
   WHERE horario_id = NEW.horario_id AND status <> 'CANCELADO';

  IF v_ocupadas >= v_capacidade THEN
    RAISE EXCEPTION 'Horário sem vagas';
  END IF;

  -- Trava o paciente para serializar agendamentos do mesmo paciente
  SELECT situacao INTO v_situacao
    FROM pacientes
   WHERE id = NEW.paciente_id
     FOR UPDATE;

  -- Aula experimental: só em pilates e só antes da avaliação
  IF NEW.experimental THEN
    IF v_modalidade <> 'PILATES' THEN
      RAISE EXCEPTION 'Aula experimental só existe para pilates';
    END IF;
    IF v_situacao <> 'AGUARDANDO_AVALIACAO' THEN
      RAISE EXCEPTION 'Aula experimental só para paciente aguardando avaliação';
    END IF;
    RETURN NEW;
  END IF;

  -- Reposição/remarcação: de um atendimento do próprio paciente, cancelado,
  -- com remarcação liberada pela cliente e da mesma modalidade
  IF NEW.reposicao_de IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM agendamentos o
        JOIN horarios oh ON oh.id = o.horario_id
       WHERE o.id = NEW.reposicao_de
         AND o.paciente_id = NEW.paciente_id
         AND oh.modalidade = v_modalidade
         AND o.status = 'CANCELADO'
         AND o.reposicao_liberada
    ) THEN
      RAISE EXCEPTION 'Reposição não liberada pela cliente para este tipo de atendimento';
    END IF;
  END IF;

  IF v_modalidade = 'AVALIACAO' THEN
    -- Não liberado, alta ou interrompido: só a cliente reabre
    IF v_situacao <> 'AGUARDANDO_AVALIACAO' THEN
      RAISE EXCEPTION 'Avaliação só para paciente aguardando avaliação';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM agendamentos a
        JOIN horarios h ON h.id = a.horario_id
       WHERE a.paciente_id = NEW.paciente_id
         AND h.modalidade = 'AVALIACAO'
         AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
    ) THEN
      RAISE EXCEPTION 'Paciente já tem uma avaliação pendente';
    END IF;
  ELSIF v_situacao <> 'LIBERADO' THEN
    RAISE EXCEPTION 'Fisioterapia e pilates só para paciente liberado';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Cancelamento individual pela cliente: a remarcação pode ser liberada para
-- qualquer modalidade (menos aula experimental, que o paciente remarca sozinho).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cancelar_pela_clinica(
  p_agendamento_id    UUID,
  p_cancelado_por     UUID,
  p_motivo            TEXT DEFAULT NULL,
  p_liberar_reposicao BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_experimental BOOLEAN;
BEGIN
  SELECT a.experimental INTO v_experimental
    FROM agendamentos a
   WHERE a.id = p_agendamento_id
     AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado ou já cancelado/realizado';
  END IF;

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_decidido_por = p_cancelado_por,
         motivo_cancelamento = COALESCE(p_motivo, motivo_cancelamento, 'Cancelado pela clínica'),
         reposicao_liberada = p_liberar_reposicao AND NOT v_experimental
   WHERE id = p_agendamento_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Notificações: aceita uma mensagem personalizada da cliente
-- -----------------------------------------------------------------------------
DROP FUNCTION fn_notificar_agendamento(tipo_notificacao, UUID);

CREATE FUNCTION fn_notificar_agendamento(
  p_tipo           tipo_notificacao,
  p_agendamento_id UUID,
  p_mensagem_extra TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_ag           agendamentos%ROWTYPE;
  v_modalidade   modalidade;
  v_nome         TEXT;
  v_desc         TEXT;
  v_desc_antigo  TEXT;
  v_destinatario papel_usuario;
  v_mensagem     TEXT;
  v_situacao     situacao_paciente;
  v_extra        TEXT;
  v_remarcar     TEXT;
  v_id           UUID;
BEGIN
  SELECT * INTO v_ag FROM agendamentos WHERE id = p_agendamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado para notificação';
  END IF;

  SELECT modalidade INTO v_modalidade FROM horarios WHERE id = v_ag.horario_id;
  SELECT nome_completo, situacao INTO v_nome, v_situacao FROM pacientes WHERE id = v_ag.paciente_id;
  v_desc := fn_descrever_agendamento(p_agendamento_id);
  v_extra := NULLIF(trim(p_mensagem_extra), '');
  v_remarcar := CASE v_modalidade
    WHEN 'PILATES' THEN ' A reposição foi liberada: escolha um horário de pilates.'
    WHEN 'FISIOTERAPIA' THEN ' A remarcação foi liberada: escolha um novo horário de fisioterapia.'
    ELSE ' A remarcação foi liberada: escolha um novo horário de avaliação.' END;

  CASE p_tipo
    -- Para a cliente
    WHEN 'AGENDAMENTO_CRIADO' THEN
      v_destinatario := 'ADMIN';
      v_mensagem := format('%s agendou %s', v_nome, v_desc);
    WHEN 'AULA_EXPERIMENTAL_MARCADA' THEN
      v_destinatario := 'ADMIN';
      v_mensagem := format('%s marcou %s', v_nome, v_desc);
    WHEN 'REPOSICAO_MARCADA' THEN
      v_destinatario := 'ADMIN';
      v_mensagem := CASE WHEN v_modalidade = 'PILATES'
        THEN format('%s marcou reposição: %s', v_nome, v_desc)
        ELSE format('%s remarcou o atendimento cancelado: %s', v_nome, v_desc) END;
    WHEN 'PRESENCA_CONFIRMADA' THEN
      v_destinatario := 'ADMIN';
      v_mensagem := format('%s confirmou presença na %s', v_nome, v_desc);
    WHEN 'CANCELAMENTO_SOLICITADO' THEN
      v_destinatario := 'ADMIN';
      v_mensagem := format('%s pediu cancelamento da %s', v_nome, v_desc)
                    || COALESCE(' (motivo: ' || v_ag.motivo_cancelamento || ')', '');

    -- Para o paciente
    WHEN 'CANCELAMENTO_APROVADO' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('Seu cancelamento da %s foi aprovado.', v_desc)
                    || CASE WHEN v_ag.reposicao_liberada THEN v_remarcar ELSE '' END;
    WHEN 'CANCELAMENTO_RECUSADO' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('Seu pedido de cancelamento da %s foi recusado; o agendamento continua de pé.', v_desc);
    WHEN 'CANCELADO_PELA_CLINICA' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('A clínica cancelou sua %s.', v_desc)
                    || COALESCE(' ' || COALESCE(v_extra, v_ag.motivo_cancelamento), '')
                    || CASE WHEN v_ag.reposicao_liberada THEN v_remarcar ELSE '' END;
    WHEN 'REMARCADO_PELA_CLINICA' THEN
      v_destinatario := 'PACIENTE';
      v_desc_antigo := fn_descrever_agendamento(v_ag.remarcado_de);
      v_mensagem := format('A clínica remarcou sua %s para %s.', v_desc_antigo,
                           regexp_replace(v_desc, '^.* de (\d\d/\d\d às \d\d:\d\d)$', '\1'))
                    || COALESCE(' ' || v_extra, '');
    WHEN 'AGENDADO_PELA_CLINICA' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('A clínica agendou uma %s para você.', v_desc) || COALESCE(' ' || v_extra, '');
    WHEN 'AVALIACAO_CONCLUIDA' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := CASE WHEN v_situacao = 'LIBERADO'
        THEN 'Sua avaliação foi concluída: você já pode agendar fisioterapia e aulas de pilates.'
        ELSE 'Sua avaliação foi concluída. Entre em contato com a clínica para mais informações.' END;
    ELSE
      RAISE EXCEPTION 'Tipo de notificação % não se aplica a agendamento', p_tipo;
  END CASE;

  INSERT INTO notificacoes (destinatario, paciente_id, agendamento_id, tipo, mensagem)
  VALUES (v_destinatario, v_ag.paciente_id, p_agendamento_id, p_tipo, v_mensagem)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Cancelamento em lote: todos os atendimentos ativos dos horários informados.
--   p_motivo              texto da cliente; vai para o agendamento e para a notificação
--   p_liberar_remarcacao  paciente pode remarcar sozinho (mesma modalidade)
--   p_bloquear_horarios   bloqueia os horários para ninguém mais agendar neles
-- Devolve uma linha por agendamento cancelado.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_cancelar_horarios(
  p_horario_ids        UUID[],
  p_cancelado_por      UUID,
  p_motivo             TEXT,
  p_liberar_remarcacao BOOLEAN DEFAULT TRUE,
  p_bloquear_horarios  BOOLEAN DEFAULT TRUE
) RETURNS TABLE (agendamento_id UUID, paciente_id UUID, horario_id UUID) AS $$
DECLARE
  v_ag RECORD;
BEGIN
  IF p_horario_ids IS NULL OR cardinality(p_horario_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhum horário informado';
  END IF;
  IF NULLIF(trim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento para avisar os pacientes';
  END IF;

  -- Trava os horários (ninguém agenda neles enquanto cancelamos)
  PERFORM 1 FROM horarios h WHERE h.id = ANY (p_horario_ids) FOR UPDATE;

  IF p_bloquear_horarios THEN
    UPDATE horarios h SET bloqueado = TRUE WHERE h.id = ANY (p_horario_ids);
  END IF;

  FOR v_ag IN
    SELECT a.id, a.paciente_id, a.horario_id, a.experimental
      FROM agendamentos a
      JOIN horarios h ON h.id = a.horario_id
     WHERE a.horario_id = ANY (p_horario_ids)
       AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     ORDER BY h.inicio
       FOR UPDATE OF a
  LOOP
    UPDATE agendamentos
       SET status = 'CANCELADO',
           cancelamento_decidido_por = p_cancelado_por,
           motivo_cancelamento = trim(p_motivo),
           reposicao_liberada = p_liberar_remarcacao AND NOT v_ag.experimental
     WHERE id = v_ag.id;

    PERFORM fn_notificar_agendamento('CANCELADO_PELA_CLINICA', v_ag.id, p_motivo);

    agendamento_id := v_ag.id;
    paciente_id    := v_ag.paciente_id;
    horario_id     := v_ag.horario_id;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMIT;
