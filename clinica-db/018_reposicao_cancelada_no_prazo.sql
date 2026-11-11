-- =============================================================================
-- 018 — Cancelar a aula de reposição também segue os 30 minutos
--   - avisando com pelo menos 30 min de antecedência, o aluno fica com a
--     reposição de volta (pode marcar outro horário)
--   - com menos de 30 min, a aula de reposição conta como dada: a reposição é
--     gasta e não volta
--   Antes, cancelar a reposição devolvia o direito em qualquer horário.
-- =============================================================================

BEGIN;

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

  -- No prazo, o aluno fica com uma reposição: a aula comum gera uma; a aula
  -- que já era reposição devolve a reposição original. Fora do prazo, a aula
  -- conta como dada: a comum não gera reposição e a reposição é gasta.
  v_remarcacao := v_no_prazo;
  IF v_ag.reposicao_de IS NOT NULL AND NOT v_no_prazo THEN
    UPDATE agendamentos SET reposicao_liberada = FALSE WHERE id = v_ag.reposicao_de;
  END IF;

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_solicitado_em = now(),
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
                      WHEN NOT v_no_prazo THEN format(' (aviso com menos de %s min: a aula conta como dada)', v_antecedencia)
                      ELSE '' END));

  RETURN v_remarcacao;
END;
$$ LANGUAGE plpgsql;

COMMIT;
