-- =============================================================================
-- 004 — Interação entre pacientes e cliente
--   - paciente confirma presença com antecedência
--   - notificações dentro do app (sem WhatsApp/e-mail/push, fora do escopo)
--       * para a cliente: ações dos pacientes
--       * para o paciente: respostas e ajustes da cliente
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 004_notificacoes.sql
-- =============================================================================

BEGIN;

-- Paciente avisa que vai comparecer
ALTER TABLE agendamentos
  ADD COLUMN presenca_confirmada_em TIMESTAMPTZ;

CREATE TYPE tipo_notificacao AS ENUM (
  -- para a cliente
  'CADASTRO_NOVO',
  'AGENDAMENTO_CRIADO',
  'AULA_EXPERIMENTAL_MARCADA',
  'REPOSICAO_MARCADA',
  'PRESENCA_CONFIRMADA',
  'CANCELAMENTO_SOLICITADO',
  -- para o paciente
  'CANCELAMENTO_APROVADO',
  'CANCELAMENTO_RECUSADO',
  'CANCELADO_PELA_CLINICA',
  'REMARCADO_PELA_CLINICA',
  'AGENDADO_PELA_CLINICA',
  'AVALIACAO_CONCLUIDA',
  'SITUACAO_ALTERADA'
);

CREATE TABLE notificacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ADMIN = vai para a cliente; PACIENTE = vai para o paciente_id abaixo
  destinatario   papel_usuario NOT NULL,
  paciente_id    UUID NOT NULL REFERENCES pacientes(id),
  agendamento_id UUID REFERENCES agendamentos(id),
  tipo           tipo_notificacao NOT NULL,
  mensagem       TEXT NOT NULL,
  lida_em        TIMESTAMPTZ,
  criada_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificacoes_cliente
  ON notificacoes (criada_em DESC)
  WHERE destinatario = 'ADMIN';

CREATE INDEX idx_notificacoes_paciente
  ON notificacoes (paciente_id, criada_em DESC)
  WHERE destinatario = 'PACIENTE';

-- -----------------------------------------------------------------------------
-- Descrição curta de um agendamento, ex.: "aula de pilates de 03/11 às 10:00"
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_descrever_agendamento(p_agendamento_id UUID) RETURNS TEXT AS $$
  SELECT CASE h.modalidade
           WHEN 'AVALIACAO'    THEN 'avaliação'
           WHEN 'FISIOTERAPIA' THEN 'sessão de fisioterapia'
           ELSE CASE WHEN a.experimental THEN 'aula experimental de pilates' ELSE 'aula de pilates' END
         END
         || ' de '
         || to_char(h.inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
    FROM agendamentos a
    JOIN horarios h ON h.id = a.horario_id
   WHERE a.id = p_agendamento_id;
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------------------------
-- Cria a notificação de um evento de agendamento com a mensagem já pronta.
-- O backend chama esta função na mesma transação da ação.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_notificar_agendamento(
  p_tipo           tipo_notificacao,
  p_agendamento_id UUID
) RETURNS UUID AS $$
DECLARE
  v_ag           agendamentos%ROWTYPE;
  v_nome         TEXT;
  v_desc         TEXT;
  v_desc_antigo  TEXT;
  v_destinatario papel_usuario;
  v_mensagem     TEXT;
  v_situacao     situacao_paciente;
  v_id           UUID;
BEGIN
  SELECT * INTO v_ag FROM agendamentos WHERE id = p_agendamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado para notificação';
  END IF;

  SELECT nome_completo, situacao INTO v_nome, v_situacao FROM pacientes WHERE id = v_ag.paciente_id;
  v_desc := fn_descrever_agendamento(p_agendamento_id);

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
      v_mensagem := format('%s marcou reposição: %s', v_nome, v_desc);
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
      v_mensagem := format('Seu cancelamento da %s foi aprovado', v_desc)
                    || CASE WHEN v_ag.reposicao_liberada THEN '. A reposição foi liberada: escolha um horário de pilates.' ELSE '.' END;
    WHEN 'CANCELAMENTO_RECUSADO' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('Seu pedido de cancelamento da %s foi recusado; o agendamento continua de pé.', v_desc);
    WHEN 'CANCELADO_PELA_CLINICA' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('A clínica cancelou sua %s', v_desc)
                    || COALESCE(' (motivo: ' || v_ag.motivo_cancelamento || ')', '')
                    || CASE WHEN v_ag.reposicao_liberada THEN '. A reposição foi liberada: escolha um horário de pilates.' ELSE '.' END;
    WHEN 'REMARCADO_PELA_CLINICA' THEN
      v_destinatario := 'PACIENTE';
      v_desc_antigo := fn_descrever_agendamento(v_ag.remarcado_de);
      v_mensagem := format('A clínica remarcou sua %s para %s.', v_desc_antigo,
                           regexp_replace(v_desc, '^.* de (\d\d/\d\d às \d\d:\d\d)$', '\1'));
    WHEN 'AGENDADO_PELA_CLINICA' THEN
      v_destinatario := 'PACIENTE';
      v_mensagem := format('A clínica agendou uma %s para você.', v_desc);
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
-- Notificações ligadas ao paciente (sem agendamento)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_notificar_paciente(
  p_tipo        tipo_notificacao,
  p_paciente_id UUID
) RETURNS UUID AS $$
DECLARE
  v_nome     TEXT;
  v_situacao situacao_paciente;
  v_dest     papel_usuario;
  v_mensagem TEXT;
  v_id       UUID;
BEGIN
  SELECT nome_completo, situacao INTO v_nome, v_situacao FROM pacientes WHERE id = p_paciente_id;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Paciente não encontrado para notificação';
  END IF;

  CASE p_tipo
    WHEN 'CADASTRO_NOVO' THEN
      v_dest := 'ADMIN';
      v_mensagem := format('%s se cadastrou e aguarda avaliação', v_nome);
    WHEN 'SITUACAO_ALTERADA' THEN
      v_dest := 'PACIENTE';
      v_mensagem := CASE v_situacao
        WHEN 'AGUARDANDO_AVALIACAO' THEN 'A clínica reabriu seu cadastro: agende uma nova avaliação.'
        WHEN 'ALTA' THEN 'Você recebeu alta. Seus agendamentos futuros foram cancelados.'
        WHEN 'INTERROMPIDO' THEN 'Seu tratamento foi interrompido. Seus agendamentos futuros foram cancelados.'
        ELSE 'Sua situação na clínica foi atualizada.' END;
    ELSE
      RAISE EXCEPTION 'Tipo de notificação % não se aplica a paciente', p_tipo;
  END CASE;

  INSERT INTO notificacoes (destinatario, paciente_id, tipo, mensagem)
  VALUES (v_dest, p_paciente_id, p_tipo, v_mensagem)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
