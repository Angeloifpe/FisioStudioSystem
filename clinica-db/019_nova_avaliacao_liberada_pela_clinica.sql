-- =============================================================================
-- 019 — Não liberado numa avaliação: nova avaliação só com liberação da clínica
-- =============================================================================
-- Se o paciente não for liberado numa avaliação (de qualquer modalidade), ele
-- não marca outra avaliação sozinho, nem da outra modalidade. Ele pede pelo app
-- e a clínica libera uma nova avaliação. Quem já estava liberado para a outra
-- modalidade continua liberado para ela.
--
--   pacientes.nova_avaliacao_bloqueada   TRUE depois de um "não liberado"
--   pacientes.nova_avaliacao_pedida_em   quando o paciente pediu a liberação
--   fn_pedir_nova_avaliacao(paciente)              paciente pede (avisa a cliente)
--   fn_liberar_nova_avaliacao(paciente, por, motivo) cliente libera (avisa o paciente)
-- =============================================================================

ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'NOVA_AVALIACAO_PEDIDA';
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'NOVA_AVALIACAO_LIBERADA';

BEGIN;

ALTER TABLE pacientes
  ADD COLUMN nova_avaliacao_bloqueada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN nova_avaliacao_pedida_em TIMESTAMPTZ;

-- Resultado "não liberado" bloqueia novas avaliações
CREATE FUNCTION fn_bloquear_nova_avaliacao() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.resultado = 'NAO_LIBERADO' THEN
    UPDATE pacientes
       SET nova_avaliacao_bloqueada = TRUE, nova_avaliacao_pedida_em = NULL
     WHERE id = NEW.paciente_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bloquear_nova_avaliacao
  AFTER INSERT ON avaliacoes
  FOR EACH ROW EXECUTE FUNCTION fn_bloquear_nova_avaliacao();

-- Reabrir o cadastro também libera uma nova avaliação
CREATE FUNCTION fn_reabrir_libera_avaliacao() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.situacao = 'AGUARDANDO_AVALIACAO' AND OLD.situacao IS DISTINCT FROM NEW.situacao THEN
    NEW.nova_avaliacao_bloqueada := FALSE;
    NEW.nova_avaliacao_pedida_em := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reabrir_libera_avaliacao
  BEFORE UPDATE OF situacao ON pacientes
  FOR EACH ROW EXECUTE FUNCTION fn_reabrir_libera_avaliacao();

-- Agendar avaliação com o bloqueio ativo é recusado
CREATE FUNCTION fn_avaliacao_exige_liberacao() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT modalidade FROM horarios WHERE id = NEW.horario_id) = 'AVALIACAO'
     AND (SELECT nova_avaliacao_bloqueada FROM pacientes WHERE id = NEW.paciente_id) THEN
    RAISE EXCEPTION 'Você não foi liberado(a) numa avaliação: peça à clínica para liberar uma nova avaliação';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_avaliacao_exige_liberacao
  BEFORE INSERT ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION fn_avaliacao_exige_liberacao();

-- Paciente pede a liberação de uma nova avaliação
CREATE FUNCTION fn_pedir_nova_avaliacao(p_paciente_id UUID) RETURNS VOID AS $$
DECLARE
  v_p pacientes%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM pacientes WHERE id = p_paciente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado';
  END IF;
  IF NOT v_p.nova_avaliacao_bloqueada THEN
    RAISE EXCEPTION 'Você já pode marcar uma avaliação';
  END IF;
  IF v_p.nova_avaliacao_pedida_em IS NOT NULL THEN
    RAISE EXCEPTION 'Você já pediu uma nova avaliação: aguarde a clínica responder';
  END IF;

  UPDATE pacientes SET nova_avaliacao_pedida_em = now() WHERE id = p_paciente_id;
  INSERT INTO notificacoes (destinatario, paciente_id, tipo, mensagem)
  VALUES ('ADMIN', p_paciente_id, 'NOVA_AVALIACAO_PEDIDA',
          format('%s não foi liberado(a) numa avaliação e pediu para fazer uma nova avaliação.', v_p.nome_completo));
END;
$$ LANGUAGE plpgsql;

-- Cliente libera uma nova avaliação
CREATE FUNCTION fn_liberar_nova_avaliacao(p_paciente_id UUID, p_por UUID DEFAULT NULL, p_motivo TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE
  v_p pacientes%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM pacientes WHERE id = p_paciente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente não encontrado';
  END IF;
  IF NOT v_p.nova_avaliacao_bloqueada AND v_p.situacao <> 'NAO_LIBERADO' THEN
    RAISE EXCEPTION 'Este paciente já pode marcar uma avaliação';
  END IF;

  IF v_p.situacao = 'NAO_LIBERADO' THEN
    -- Sem nenhuma liberação: volta a aguardar avaliação
    PERFORM fn_mudar_situacao_paciente(p_paciente_id, 'AGUARDANDO_AVALIACAO',
      COALESCE(NULLIF(trim(p_motivo), ''), 'Nova avaliação liberada pela clínica'), p_por);
  END IF;

  UPDATE pacientes SET nova_avaliacao_bloqueada = FALSE, nova_avaliacao_pedida_em = NULL WHERE id = p_paciente_id;
  INSERT INTO notificacoes (destinatario, paciente_id, tipo, mensagem)
  VALUES ('PACIENTE', p_paciente_id, 'NOVA_AVALIACAO_LIBERADA',
          'A clínica liberou uma nova avaliação para você. Escolha um horário em Agendar.'
          || COALESCE(' ' || NULLIF(trim(p_motivo), ''), ''));
END;
$$ LANGUAGE plpgsql;

-- Quem já tem um "não liberado" como última avaliação fica bloqueado
UPDATE pacientes p
   SET nova_avaliacao_bloqueada = TRUE
 WHERE p.situacao IN ('NAO_LIBERADO', 'LIBERADO')
   AND (SELECT a.resultado FROM avaliacoes a WHERE a.paciente_id = p.id ORDER BY a.avaliado_em DESC LIMIT 1) = 'NAO_LIBERADO';

COMMIT;
