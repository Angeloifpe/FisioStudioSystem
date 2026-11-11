-- =============================================================================
-- 014 — Avaliação por modalidade
--   - ao pedir a avaliação, o aluno escolhe para quê: PILATES, FISIOTERAPIA
--     ou AMBAS
--   - liberado na avaliação, ele só agenda a modalidade avaliada; com as duas
--     avaliações (ou uma de AMBAS) fica liberado para as duas
--   - quem já está liberado para uma modalidade pode pedir a avaliação da outra
--   - aula experimental de pilates: para quem ainda não foi liberado para o pilates
--   - a cliente pode liberar menos do que foi pedido (ex.: pediu AMBAS, liberou
--     só pilates)
--   - quem já era LIBERADO antes desta atualização fica liberado para as duas
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 014_avaliacao_por_modalidade.sql
-- =============================================================================

BEGIN;

CREATE TYPE avaliacao_para AS ENUM ('PILATES', 'FISIOTERAPIA', 'AMBAS');

ALTER TABLE pacientes
  ADD COLUMN liberado_pilates      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN liberado_fisioterapia BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE pacientes SET liberado_pilates = TRUE, liberado_fisioterapia = TRUE
 WHERE situacao = 'LIBERADO';

-- Agendamento de avaliação: para qual modalidade
ALTER TABLE agendamentos ADD COLUMN avaliacao_para avaliacao_para;
UPDATE agendamentos a SET avaliacao_para = 'AMBAS'
  FROM horarios h WHERE h.id = a.horario_id AND h.modalidade = 'AVALIACAO';

-- Histórico: o que foi avaliado e para o que o paciente foi liberado
ALTER TABLE avaliacoes
  ADD COLUMN avaliacao_para avaliacao_para,
  ADD COLUMN liberado_para  avaliacao_para;
UPDATE avaliacoes SET avaliacao_para = 'AMBAS',
                      liberado_para = CASE WHEN resultado = 'LIBERADO' THEN 'AMBAS'::avaliacao_para END;

-- Reabrir o cadastro (voltar a aguardar avaliação) zera as liberações
CREATE FUNCTION fn_reabrir_zera_liberacoes() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.situacao = 'AGUARDANDO_AVALIACAO' AND OLD.situacao IS DISTINCT FROM 'AGUARDANDO_AVALIACAO' THEN
    NEW.liberado_pilates := FALSE;
    NEW.liberado_fisioterapia := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reabrir_zera_liberacoes
  BEFORE UPDATE OF situacao ON pacientes
  FOR EACH ROW EXECUTE FUNCTION fn_reabrir_zera_liberacoes();

-- Horário fixo de pilates: só para quem foi liberado para o pilates
CREATE FUNCTION fn_fixo_exige_liberacao_pilates() RETURNS TRIGGER AS $$
BEGIN
  IF NOT (SELECT liberado_pilates FROM pacientes WHERE id = NEW.paciente_id) THEN
    RAISE EXCEPTION 'Você ainda não foi liberado para o pilates: faça a avaliação de pilates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fixo_exige_liberacao_pilates
  BEFORE INSERT ON pilates_fixos
  FOR EACH ROW EXECUTE FUNCTION fn_fixo_exige_liberacao_pilates();

-- -----------------------------------------------------------------------------
-- Validação do agendamento (versão da 006 + liberação por modalidade)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_agendamento() RETURNS TRIGGER AS $$
DECLARE
  v_modalidade modalidade;
  v_capacidade SMALLINT;
  v_bloqueado  BOOLEAN;
  v_ocupadas   INTEGER;
  v_situacao   situacao_paciente;
  v_lib_pil    BOOLEAN;
  v_lib_fis    BOOLEAN;
  v_inicio     TIMESTAMPTZ;
  v_semana     INTEGER;
BEGIN
  -- Trava o horário para que agendamentos simultâneos não estourem as vagas
  SELECT modalidade, capacidade, bloqueado, inicio
    INTO v_modalidade, v_capacidade, v_bloqueado, v_inicio
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
  SELECT situacao, liberado_pilates, liberado_fisioterapia
    INTO v_situacao, v_lib_pil, v_lib_fis
    FROM pacientes
   WHERE id = NEW.paciente_id
     FOR UPDATE;

  -- Só a avaliação diz para qual modalidade é
  IF v_modalidade = 'AVALIACAO' THEN
    NEW.avaliacao_para := COALESCE(NEW.avaliacao_para, 'AMBAS');
  ELSE
    NEW.avaliacao_para := NULL;
  END IF;

  -- Aula experimental: só em pilates e só para quem ainda não foi liberado para o pilates
  IF NEW.experimental THEN
    IF v_modalidade <> 'PILATES' THEN
      RAISE EXCEPTION 'Aula experimental só existe para pilates';
    END IF;
    IF v_situacao NOT IN ('AGUARDANDO_AVALIACAO', 'LIBERADO') OR v_lib_pil THEN
      RAISE EXCEPTION 'Aula experimental só para paciente aguardando avaliação de pilates';
    END IF;
    RETURN NEW;
  END IF;

  -- Reposição/remarcação: de um atendimento do próprio paciente, cancelado,
  -- com remarcação liberada e da mesma modalidade
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
    -- Aguardando avaliação: qualquer escolha. Liberado: só para a modalidade
    -- que ainda falta. Não liberado, alta ou interrompido: só a cliente reabre.
    IF v_situacao = 'LIBERADO' THEN
      IF v_lib_pil AND v_lib_fis THEN
        RAISE EXCEPTION 'Avaliação só para paciente aguardando avaliação: você já está liberado para pilates e fisioterapia';
      ELSIF NEW.avaliacao_para IN ('PILATES', 'AMBAS') AND v_lib_pil THEN
        RAISE EXCEPTION 'Você já está liberado para o pilates: escolha a avaliação de fisioterapia';
      ELSIF NEW.avaliacao_para IN ('FISIOTERAPIA', 'AMBAS') AND v_lib_fis THEN
        RAISE EXCEPTION 'Você já está liberado para a fisioterapia: escolha a avaliação de pilates';
      END IF;
    ELSIF v_situacao <> 'AGUARDANDO_AVALIACAO' THEN
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
  ELSIF v_modalidade = 'PILATES' AND NOT v_lib_pil THEN
    RAISE EXCEPTION 'Você ainda não foi liberado para o pilates: faça a avaliação de pilates';
  ELSIF v_modalidade = 'FISIOTERAPIA' AND NOT v_lib_fis THEN
    RAISE EXCEPTION 'Você ainda não foi liberado para a fisioterapia: faça a avaliação de fisioterapia';
  END IF;

  -- Pilates regular: até 2 aulas por semana, em dias diferentes
  -- (reposição não entra na conta)
  IF v_modalidade = 'PILATES' AND NEW.reposicao_de IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM agendamentos a
        JOIN horarios h ON h.id = a.horario_id
       WHERE a.paciente_id = NEW.paciente_id
         AND h.modalidade = 'PILATES'
         AND NOT a.experimental
         AND a.reposicao_de IS NULL
         AND a.status <> 'CANCELADO'
         AND (h.inicio AT TIME ZONE 'America/Sao_Paulo')::date = (v_inicio AT TIME ZONE 'America/Sao_Paulo')::date
    ) THEN
      RAISE EXCEPTION 'Já existe uma aula de pilates sua neste dia';
    END IF;

    SELECT COUNT(*) INTO v_semana
      FROM agendamentos a
      JOIN horarios h ON h.id = a.horario_id
     WHERE a.paciente_id = NEW.paciente_id
       AND h.modalidade = 'PILATES'
       AND NOT a.experimental
       AND a.reposicao_de IS NULL
       AND a.status <> 'CANCELADO'
       AND date_trunc('week', h.inicio AT TIME ZONE 'America/Sao_Paulo')
         = date_trunc('week', v_inicio AT TIME ZONE 'America/Sao_Paulo');

    IF v_semana >= 2 THEN
      RAISE EXCEPTION 'Limite de 2 aulas de pilates por semana atingido';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Conclusão da avaliação: libera a(s) modalidade(s) avaliada(s)
-- p_liberar_para: a cliente pode liberar menos do que foi pedido (padrão: o pedido)
-- -----------------------------------------------------------------------------
DROP FUNCTION fn_concluir_avaliacao(UUID, resultado_avaliacao, TEXT, UUID);

CREATE FUNCTION fn_concluir_avaliacao(
  p_agendamento_id UUID,
  p_resultado      resultado_avaliacao,
  p_observacoes    TEXT,
  p_avaliado_por   UUID,
  p_liberar_para   avaliacao_para DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_paciente_id  UUID;
  v_pedido       avaliacao_para;
  v_liberar      avaliacao_para;
  v_avaliacao_id UUID;
BEGIN
  SELECT a.paciente_id, COALESCE(a.avaliacao_para, 'AMBAS') INTO v_paciente_id, v_pedido
    FROM agendamentos a
    JOIN horarios h ON h.id = a.horario_id
   WHERE a.id = p_agendamento_id
     AND h.modalidade = 'AVALIACAO'
     AND a.status IN ('AGENDADO', 'REALIZADO')
     FOR UPDATE OF a;

  IF v_paciente_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento de avaliação não encontrado ou não pode ser concluído';
  END IF;

  IF p_resultado = 'LIBERADO' THEN
    v_liberar := COALESCE(p_liberar_para, v_pedido);
    IF v_pedido <> 'AMBAS' AND v_liberar <> v_pedido THEN
      RAISE EXCEPTION 'Esta avaliação foi de %: só dá para liberar essa modalidade', lower(v_pedido::text);
    END IF;
  END IF;

  UPDATE agendamentos
     SET status = 'REALIZADO',
         presenca_registrada_em = COALESCE(presenca_registrada_em, now())
   WHERE id = p_agendamento_id;

  INSERT INTO avaliacoes (paciente_id, agendamento_id, resultado, observacoes, avaliado_por, avaliacao_para, liberado_para)
  VALUES (v_paciente_id, p_agendamento_id, p_resultado, p_observacoes, p_avaliado_por, v_pedido, v_liberar)
  RETURNING id INTO v_avaliacao_id;

  IF p_resultado = 'LIBERADO' THEN
    UPDATE pacientes
       SET liberado_pilates      = liberado_pilates      OR v_liberar IN ('PILATES', 'AMBAS'),
           liberado_fisioterapia = liberado_fisioterapia OR v_liberar IN ('FISIOTERAPIA', 'AMBAS'),
           situacao = 'LIBERADO'
     WHERE id = v_paciente_id;
  ELSE
    -- Não liberado: se já estava liberado para a outra modalidade, continua liberado
    UPDATE pacientes
       SET situacao = 'NAO_LIBERADO'
     WHERE id = v_paciente_id AND NOT (liberado_pilates OR liberado_fisioterapia);
  END IF;

  RETURN v_avaliacao_id;
END;
$$ LANGUAGE plpgsql;

-- Aviso de avaliação concluída diz para qual modalidade o paciente foi liberado
CREATE FUNCTION fn_mensagem_avaliacao_concluida() RETURNS TRIGGER AS $$
DECLARE
  v_av  avaliacoes%ROWTYPE;
  v_pil BOOLEAN;
  v_fis BOOLEAN;
BEGIN
  SELECT * INTO v_av FROM avaliacoes WHERE agendamento_id = NEW.agendamento_id ORDER BY avaliado_em DESC LIMIT 1;
  IF v_av.id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT liberado_pilates, liberado_fisioterapia INTO v_pil, v_fis FROM pacientes WHERE id = NEW.paciente_id;

  NEW.mensagem := CASE
    WHEN v_av.resultado = 'LIBERADO' THEN
      'Sua avaliação foi concluída: você já pode agendar '
      || CASE WHEN v_pil AND v_fis THEN 'fisioterapia e aulas de pilates'
              WHEN v_pil THEN 'aulas de pilates'
              ELSE 'fisioterapia' END
      || '.'
    WHEN v_pil OR v_fis THEN
      'Sua avaliação de ' || CASE v_av.avaliacao_para WHEN 'PILATES' THEN 'pilates' WHEN 'FISIOTERAPIA' THEN 'fisioterapia' ELSE 'pilates e fisioterapia' END
      || ' foi concluída sem liberação. Você continua liberado para '
      || CASE WHEN v_pil AND v_fis THEN 'fisioterapia e pilates' WHEN v_pil THEN 'pilates' ELSE 'fisioterapia' END
      || '. Fale com a clínica para mais informações.'
    ELSE 'Sua avaliação foi concluída. Entre em contato com a clínica para mais informações.'
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mensagem_avaliacao_concluida
  BEFORE INSERT ON notificacoes
  FOR EACH ROW WHEN (NEW.tipo = 'AVALIACAO_CONCLUIDA')
  EXECUTE FUNCTION fn_mensagem_avaliacao_concluida();

COMMIT;
