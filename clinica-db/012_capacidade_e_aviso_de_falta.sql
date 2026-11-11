-- =============================================================================
-- 012 — Capacidade das turmas de pilates e aviso de falta
--
-- 1. Capacidade definida pela cliente (até 8 alunos):
--    - cada aula da grade tem a sua capacidade (padrão 8)
--    - a capacidade de uma aula num dia específico também pode ser mudada
--    - não dá para reduzir abaixo do número de alunos já agendados
--    - fisioterapia e avaliação continuam com 1 vaga
--
-- 2. Aviso de falta no pilates (turma = horários fixos do aluno, ex.: seg e
--    qua 06:00–07:00):
--    - avisando com pelo menos 30 minutos de antecedência (configurável), a
--      aula daquele dia é cancelada na hora, o aluno ganha uma remarcação e a
--      vaga fica livre para qualquer aluno (não precisa ser daquela turma)
--    - com menos de 30 minutos, a aula conta como dada (sem remarcação)
--    - aula de reposição desmarcada a tempo devolve o direito à reposição
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 012_capacidade_e_aviso_de_falta.sql
-- =============================================================================

-- Novo tipo de notificação (fora da transação: exigência do PostgreSQL)
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'FALTA_AVISADA';

BEGIN;

-- -----------------------------------------------------------------------------
-- Configurações da clínica (uma linha só)
-- -----------------------------------------------------------------------------
CREATE TABLE config_clinica (
  id                          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  capacidade_padrao_pilates   SMALLINT NOT NULL DEFAULT 8 CHECK (capacidade_padrao_pilates BETWEEN 1 AND 8),
  antecedencia_aviso_falta_min SMALLINT NOT NULL DEFAULT 30 CHECK (antecedencia_aviso_falta_min BETWEEN 0 AND 1440)
);
INSERT INTO config_clinica DEFAULT VALUES;

COMMENT ON TABLE config_clinica IS
  'Configurações gerais: capacidade padrão das aulas de pilates e antecedência mínima do aviso de falta (minutos)';

-- -----------------------------------------------------------------------------
-- 1. Capacidade
-- -----------------------------------------------------------------------------
ALTER TABLE pilates_grade
  ADD COLUMN capacidade SMALLINT NOT NULL DEFAULT 8 CHECK (capacidade BETWEEN 1 AND 8);

-- Até aqui a capacidade era calculada (4 no pilates, 1 no resto); agora é editável
ALTER TABLE horarios ALTER COLUMN capacidade DROP EXPRESSION;
ALTER TABLE horarios
  ADD CONSTRAINT ck_horarios_capacidade CHECK (
    (modalidade = 'PILATES' AND capacidade BETWEEN 1 AND 8)
    OR (modalidade <> 'PILATES' AND capacidade = 1)
  );

-- Capacidade de um horário novo: pilates = a da aula na grade (ou a padrão);
-- outras modalidades = 1
CREATE FUNCTION fn_horario_capacidade() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.modalidade <> 'PILATES' THEN
    NEW.capacidade := 1;
  ELSIF NEW.capacidade IS NULL THEN
    SELECT g.capacidade INTO NEW.capacidade
      FROM pilates_grade g
     WHERE g.dia_semana = fn_dia_semana(NEW.inicio)
       AND g.inicio = fn_hora_local(NEW.inicio)
       AND g.fim = fn_hora_local(NEW.fim);
    IF NEW.capacidade IS NULL THEN
      SELECT capacidade_padrao_pilates INTO NEW.capacidade FROM config_clinica;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- "trg_0..." para rodar antes dos outros gatilhos BEFORE INSERT
CREATE TRIGGER trg_0_horario_capacidade
  BEFORE INSERT ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_horario_capacidade();

ALTER TABLE horarios ALTER COLUMN capacidade SET NOT NULL;

-- Não reduz a capacidade abaixo dos alunos já agendados
CREATE FUNCTION fn_capacidade_nao_menor_que_agendados() RETURNS TRIGGER AS $$
DECLARE
  v_ativos INTEGER;
BEGIN
  IF NEW.capacidade < OLD.capacidade THEN
    SELECT COUNT(*) INTO v_ativos FROM agendamentos
     WHERE horario_id = NEW.id AND status <> 'CANCELADO';
    IF v_ativos > NEW.capacidade THEN
      RAISE EXCEPTION 'Esta aula já tem % alunos agendados; desmarque alguém antes de reduzir para %',
        v_ativos, NEW.capacidade;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_capacidade_nao_menor_que_agendados
  BEFORE UPDATE OF capacidade ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_capacidade_nao_menor_que_agendados();

-- Aulas de pilates futuras passam a ter a capacidade da grade (8)
UPDATE horarios h
   SET capacidade = g.capacidade
  FROM pilates_grade g
 WHERE h.modalidade = 'PILATES'
   AND h.inicio > now()
   AND g.dia_semana = fn_dia_semana(h.inicio)
   AND g.inicio = fn_hora_local(h.inicio)
   AND g.fim = fn_hora_local(h.fim)
   AND h.capacidade < g.capacidade;

-- A cliente muda a capacidade de uma aula da grade e, se quiser, das aulas
-- futuras já abertas daquele horário. Devolve as aulas que não puderam ser
-- reduzidas (já têm mais alunos que a nova capacidade).
CREATE FUNCTION fn_definir_capacidade_turma(
  p_dia_semana SMALLINT,
  p_inicio     TIME,
  p_capacidade SMALLINT,
  p_aplicar_nas_aulas_abertas BOOLEAN DEFAULT TRUE
) RETURNS TABLE (horario_id UUID, inicio TIMESTAMPTZ, agendados INTEGER) AS $$
DECLARE
  v_fim  TIME;
  v_aula RECORD;
BEGIN
  UPDATE pilates_grade g SET capacidade = p_capacidade
   WHERE g.dia_semana = p_dia_semana AND g.inicio = p_inicio
  RETURNING g.fim INTO v_fim;
  IF v_fim IS NULL THEN
    RAISE EXCEPTION 'Não há aula na grade neste dia e horário';
  END IF;

  IF NOT p_aplicar_nas_aulas_abertas THEN
    RETURN;
  END IF;

  FOR v_aula IN
    SELECT h.id, h.inicio,
           (SELECT COUNT(*) FROM agendamentos a WHERE a.horario_id = h.id AND a.status <> 'CANCELADO')::INTEGER AS ativos
      FROM horarios h
     WHERE h.modalidade = 'PILATES' AND h.inicio > now() AND NOT h.cancelado
       AND fn_dia_semana(h.inicio) = p_dia_semana
       AND fn_hora_local(h.inicio) = p_inicio
       AND fn_hora_local(h.fim) = v_fim
     ORDER BY h.inicio
  LOOP
    IF v_aula.ativos > p_capacidade THEN
      horario_id := v_aula.id; inicio := v_aula.inicio; agendados := v_aula.ativos;
      RETURN NEXT;
    ELSE
      UPDATE horarios SET capacidade = p_capacidade WHERE id = v_aula.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Aviso de falta no pilates
-- -----------------------------------------------------------------------------
-- O aluno avisa que não vai a uma aula de pilates (regular ou reposição).
-- Com a antecedência mínima: cancela na hora, libera a vaga e dá a remarcação.
-- Devolve TRUE se gerou o direito a remarcar.
CREATE FUNCTION fn_avisar_falta_pilates(
  p_agendamento_id UUID,
  p_paciente_id    UUID,
  p_motivo         TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_ag          agendamentos%ROWTYPE;
  v_inicio      TIMESTAMPTZ;
  v_modalidade  modalidade;
  v_antecedencia INTEGER;
  v_nome        TEXT;
  v_remarcacao  BOOLEAN;
BEGIN
  SELECT a.* INTO v_ag FROM agendamentos a
   WHERE a.id = p_agendamento_id AND a.paciente_id = p_paciente_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  SELECT h.inicio, h.modalidade INTO v_inicio, v_modalidade FROM horarios h WHERE h.id = v_ag.horario_id;
  IF v_modalidade <> 'PILATES' OR v_ag.experimental THEN
    RAISE EXCEPTION 'O aviso de falta com remarcação vale para aula de pilates regular';
  END IF;
  IF v_ag.status <> 'AGENDADO' THEN
    RAISE EXCEPTION 'Esta aula não está mais agendada';
  END IF;
  IF v_inicio <= now() THEN
    RAISE EXCEPTION 'A aula já começou';
  END IF;

  SELECT antecedencia_aviso_falta_min INTO v_antecedencia FROM config_clinica;
  IF v_inicio - now() < make_interval(mins => v_antecedencia) THEN
    RAISE EXCEPTION 'Faltam menos de % minutos para a aula: ela conta como dada e não gera remarcação', v_antecedencia;
  END IF;

  -- Aula comum gera reposição; aula que já era reposição devolve a reposição original
  v_remarcacao := v_ag.reposicao_de IS NULL;

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_solicitado_em = now(),
         motivo_cancelamento = COALESCE(NULLIF(trim(p_motivo), ''), 'Aluno avisou que não vai'),
         reposicao_liberada = v_remarcacao
   WHERE id = p_agendamento_id;

  SELECT nome_completo INTO v_nome FROM pacientes WHERE id = p_paciente_id;
  INSERT INTO notificacoes (destinatario, paciente_id, agendamento_id, tipo, mensagem)
  VALUES ('ADMIN', p_paciente_id, p_agendamento_id, 'FALTA_AVISADA',
          format('%s avisou que não vai à %s. A vaga foi liberada%s.',
                 v_nome, fn_descrever_agendamento(p_agendamento_id),
                 CASE WHEN v_remarcacao THEN ' e o aluno pode remarcar' ELSE '' END));

  RETURN v_remarcacao;
END;
$$ LANGUAGE plpgsql;

COMMIT;
