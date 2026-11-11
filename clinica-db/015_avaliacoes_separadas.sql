-- =============================================================================
-- 015 — Avaliações separadas por modalidade
--   - cada avaliação é de uma modalidade só: pilates ou fisioterapia (o app
--     não oferece mais "as duas"; AMBAS fica só para avaliações antigas)
--   - o aluno pode ter ao mesmo tempo uma avaliação de pilates e uma de
--     fisioterapia marcadas (uma pendente por modalidade)
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 015_avaliacoes_separadas.sql
-- =============================================================================

BEGIN;

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

    -- Uma avaliação pendente por modalidade (dá para marcar a de pilates e a
    -- de fisioterapia ao mesmo tempo)
    IF EXISTS (
      SELECT 1
        FROM agendamentos a
        JOIN horarios h ON h.id = a.horario_id
       WHERE a.paciente_id = NEW.paciente_id
         AND h.modalidade = 'AVALIACAO'
         AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
         AND (a.avaliacao_para = NEW.avaliacao_para OR 'AMBAS' IN (a.avaliacao_para, NEW.avaliacao_para))
    ) THEN
      RAISE EXCEPTION 'Paciente já tem uma avaliação pendente de %',
        CASE NEW.avaliacao_para WHEN 'PILATES' THEN 'pilates' WHEN 'FISIOTERAPIA' THEN 'fisioterapia' ELSE 'pilates ou fisioterapia' END;
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

COMMIT;
