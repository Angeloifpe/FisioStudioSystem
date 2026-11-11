-- =============================================================================
-- 016 — Ao se matricular numa turma fixa, as aulas avulsas de pilates somem
-- =============================================================================
-- O aluno matriculado só faz as aulas das turmas dele (e reposições). Quando ele
-- fixa uma turma, as aulas avulsas de pilates que ele tinha marcado para o futuro
-- são canceladas (sem gerar remarcação) e as aulas da turma são reservadas no
-- lugar. Antes, uma aula avulsa no mesmo dia da semana ficava na agenda e ainda
-- impedia a reserva da aula da turma naquela semana (2 aulas por semana, em dias
-- diferentes).
--
-- Reposições e aulas experimentais não são mexidas.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_cancelar_avulsas_pilates(p_paciente_id UUID) RETURNS INTEGER AS $$
DECLARE
  v_qtd INTEGER;
BEGIN
  UPDATE agendamentos a
     SET status = 'CANCELADO',
         motivo_cancelamento = 'Substituída pelo horário fixo',
         reposicao_liberada = FALSE
    FROM horarios h
   WHERE h.id = a.horario_id
     AND a.paciente_id = p_paciente_id
     AND h.modalidade = 'PILATES'
     AND a.fixo_id IS NULL
     AND a.reposicao_de IS NULL
     AND NOT a.experimental
     AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     AND h.inicio > now();
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_fixar_pilates(p_paciente_id UUID, p_dia_semana SMALLINT, p_hora TIME) RETURNS UUID AS $$
DECLARE
  v_situacao situacao_paciente;
  v_id       UUID;
BEGIN
  IF p_dia_semana NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'A clínica funciona de segunda a sexta';
  END IF;

  SELECT situacao INTO v_situacao FROM pacientes WHERE id = p_paciente_id FOR UPDATE;
  IF v_situacao IS DISTINCT FROM 'LIBERADO' THEN
    RAISE EXCEPTION 'Só alunos liberados podem fixar horário de pilates';
  END IF;

  IF (SELECT COUNT(*) FROM pilates_fixos WHERE paciente_id = p_paciente_id AND ativo) >= 2 THEN
    RAISE EXCEPTION 'Você já tem 2 horários fixos; desfaça um antes de escolher outro';
  END IF;

  IF EXISTS (SELECT 1 FROM pilates_fixos WHERE paciente_id = p_paciente_id AND ativo AND dia_semana = p_dia_semana) THEN
    RAISE EXCEPTION 'Você já tem um horário fixo neste dia da semana';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM horarios
     WHERE modalidade = 'PILATES' AND inicio > now()
       AND fn_dia_semana(inicio) = p_dia_semana AND fn_hora_local(inicio) = p_hora
  ) THEN
    RAISE EXCEPTION 'A clínica não tem turma de pilates aberta neste dia e horário';
  END IF;

  -- Matriculado não tem aula avulsa: as que estavam marcadas saem da agenda
  PERFORM fn_cancelar_avulsas_pilates(p_paciente_id);

  INSERT INTO pilates_fixos (paciente_id, dia_semana, hora)
  VALUES (p_paciente_id, p_dia_semana, p_hora)
  RETURNING id INTO v_id;

  -- Reserva também as aulas das outras turmas dele que tinham sido puladas por
  -- causa das avulsas (fn_aplicar_fixo ignora as que já estão reservadas)
  PERFORM fn_aplicar_fixo(f.id)
     FROM pilates_fixos f
    WHERE f.paciente_id = p_paciente_id AND f.ativo
    ORDER BY f.id = v_id DESC;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Acerta quem já é matriculado e ainda tem aulas avulsas marcadas
DO $$
DECLARE
  v_p UUID;
BEGIN
  FOR v_p IN SELECT DISTINCT paciente_id FROM pilates_fixos WHERE ativo LOOP
    IF fn_cancelar_avulsas_pilates(v_p) > 0 THEN
      PERFORM fn_aplicar_fixo(f.id) FROM pilates_fixos f WHERE f.paciente_id = v_p AND f.ativo;
    END IF;
  END LOOP;
END $$;

COMMIT;
