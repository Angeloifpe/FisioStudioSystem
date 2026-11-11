-- =============================================================================
-- 017 — Feriado não dá remarcação
-- =============================================================================
-- Ao cadastrar um feriado, os atendimentos do dia são cancelados e cada paciente
-- é avisado, mas sem remarcação. A remarcação fica para quando a cliente fecha
-- um dia por outro motivo (cancelar em lote, com "liberar remarcação").
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_fechar_dia(p_data DATE, p_motivo TEXT, p_por UUID DEFAULT NULL) RETURNS INTEGER AS $$
DECLARE
  v_ids UUID[];
  v_qtd INTEGER := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids
    FROM horarios
   WHERE (inicio AT TIME ZONE 'America/Sao_Paulo')::date = p_data
     AND inicio > now();

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM agendamentos
     WHERE horario_id = ANY (v_ids) AND status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
  ) THEN
    -- Feriado (ou fim de semana): cancela e avisa, sem liberar remarcação
    SELECT COUNT(*) INTO v_qtd FROM fn_cancelar_horarios(v_ids, p_por, p_motivo, FALSE, TRUE);
  END IF;

  -- Horários que nunca tiveram agendamento somem; os outros ficam bloqueados (histórico)
  DELETE FROM horarios h
   WHERE h.id = ANY (v_ids)
     AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.horario_id = h.id);
  UPDATE horarios SET bloqueado = TRUE WHERE id = ANY (v_ids);

  RETURN v_qtd;
END;
$$ LANGUAGE plpgsql;

-- Remarcações de feriado ainda não usadas deixam de valer
UPDATE agendamentos a
   SET reposicao_liberada = FALSE
 WHERE a.motivo_cancelamento LIKE 'Feriado:%'
   AND a.reposicao_liberada
   AND NOT EXISTS (SELECT 1 FROM agendamentos r WHERE r.reposicao_de = a.id AND r.status <> 'CANCELADO');

COMMIT;
