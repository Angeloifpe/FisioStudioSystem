-- =============================================================================
-- 006 — Pilates: até 2 dias por semana e horário fixo; clínica de segunda a sexta
--   - a clínica funciona de segunda a sexta: horários no sábado ou domingo
--     são recusados (os que já existiam: os vazios são apagados e os que têm
--     agendamento ficam bloqueados para a cliente resolver)
--   - cada aluno faz no máximo 2 aulas regulares de pilates por semana
--     (segunda a domingo), em dias diferentes; reposição e aula experimental
--     não entram na conta
--   - o aluno pode fixar até 2 turmas (dia da semana + horário); o sistema
--     reserva a vaga dele em todas as aulas dessas turmas, inclusive nas que a
--     clínica abrir depois, enquanto ele estiver LIBERADO
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 006_pilates_semanal.sql
-- =============================================================================

-- Novos tipos de notificação (fora da transação: exigência do PostgreSQL)
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'HORARIO_FIXO_DEFINIDO';
ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'HORARIO_FIXO_ENCERRADO';

BEGIN;

-- Dia da semana e hora no fuso da clínica
CREATE FUNCTION fn_dia_semana(p_inicio TIMESTAMPTZ) RETURNS SMALLINT AS $$
  SELECT extract(isodow FROM p_inicio AT TIME ZONE 'America/Sao_Paulo')::SMALLINT;
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION fn_hora_local(p_inicio TIMESTAMPTZ) RETURNS TIME AS $$
  SELECT (p_inicio AT TIME ZONE 'America/Sao_Paulo')::TIME;
$$ LANGUAGE sql IMMUTABLE;

-- -----------------------------------------------------------------------------
-- A clínica funciona de segunda a sexta
-- -----------------------------------------------------------------------------
-- Horários de fim de semana que já existiam: apaga os que nunca tiveram
-- agendamento e bloqueia os futuros que têm (a cliente decide o que fazer)
DELETE FROM horarios h
 WHERE fn_dia_semana(h.inicio) IN (6, 7)
   AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.horario_id = h.id);

UPDATE horarios SET bloqueado = TRUE
 WHERE fn_dia_semana(inicio) IN (6, 7) AND inicio > now();

-- Daqui em diante, só de segunda (1) a sexta (5)
ALTER TABLE horarios
  ADD CONSTRAINT ck_horarios_dias_uteis
  CHECK (fn_dia_semana(inicio) BETWEEN 1 AND 5) NOT VALID;

-- -----------------------------------------------------------------------------
-- Turmas fixas de cada aluno
-- -----------------------------------------------------------------------------
CREATE TABLE pilates_fixos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id  UUID NOT NULL REFERENCES pacientes(id),
  dia_semana   SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 5), -- 1 = segunda ... 5 = sexta
  hora         TIME NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  encerrado_em TIMESTAMPTZ
);

-- Um fixo ativo por dia da semana (2 dias diferentes)
CREATE UNIQUE INDEX uq_pilates_fixo_dia
  ON pilates_fixos (paciente_id, dia_semana)
  WHERE ativo;

CREATE INDEX idx_pilates_fixos_turma ON pilates_fixos (dia_semana, hora) WHERE ativo;

-- Agendamentos criados pelo horário fixo
ALTER TABLE agendamentos
  ADD COLUMN fixo_id UUID REFERENCES pilates_fixos(id);

-- -----------------------------------------------------------------------------
-- Gatilho de agendamento: acrescenta o limite semanal do pilates
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valida_agendamento() RETURNS TRIGGER AS $$
DECLARE
  v_modalidade modalidade;
  v_capacidade SMALLINT;
  v_bloqueado  BOOLEAN;
  v_ocupadas   INTEGER;
  v_situacao   situacao_paciente;
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
-- Tenta agendar o aluno numa aula da turma fixa. Não interrompe nada se não
-- der (sem vaga, limite da semana, horário bloqueado...): só devolve FALSE.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_agendar_aula_fixa(p_fixo_id UUID, p_horario_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_paciente UUID;
BEGIN
  SELECT paciente_id INTO v_paciente FROM pilates_fixos WHERE id = p_fixo_id AND ativo;
  IF v_paciente IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Já está nesta aula?
  IF EXISTS (
    SELECT 1 FROM agendamentos
     WHERE paciente_id = v_paciente AND horario_id = p_horario_id AND status <> 'CANCELADO'
  ) THEN
    RETURN FALSE;
  END IF;

  BEGIN
    INSERT INTO agendamentos (paciente_id, horario_id, fixo_id)
    VALUES (v_paciente, p_horario_id, p_fixo_id);
    RETURN TRUE;
  EXCEPTION WHEN raise_exception OR unique_violation THEN
    RETURN FALSE;
  END;
END;
$$ LANGUAGE plpgsql;

-- Reserva o aluno em todas as aulas futuras (já abertas) da turma fixa
CREATE FUNCTION fn_aplicar_fixo(p_fixo_id UUID) RETURNS INTEGER AS $$
DECLARE
  v_fixo pilates_fixos%ROWTYPE;
  v_h    RECORD;
  v_qtd  INTEGER := 0;
BEGIN
  SELECT * INTO v_fixo FROM pilates_fixos WHERE id = p_fixo_id AND ativo;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR v_h IN
    SELECT id FROM horarios
     WHERE modalidade = 'PILATES'
       AND inicio > now()
       AND fn_dia_semana(inicio) = v_fixo.dia_semana
       AND fn_hora_local(inicio) = v_fixo.hora
     ORDER BY inicio
  LOOP
    IF fn_agendar_aula_fixa(p_fixo_id, v_h.id) THEN
      v_qtd := v_qtd + 1;
    END IF;
  END LOOP;

  RETURN v_qtd;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Aluno fixa uma turma (dia da semana + hora). Devolve o id do fixo.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_fixar_pilates(p_paciente_id UUID, p_dia_semana SMALLINT, p_hora TIME) RETURNS UUID AS $$
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

  INSERT INTO pilates_fixos (paciente_id, dia_semana, hora)
  VALUES (p_paciente_id, p_dia_semana, p_hora)
  RETURNING id INTO v_id;

  PERFORM fn_aplicar_fixo(v_id);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Desfaz o horário fixo e cancela as aulas futuras reservadas por ele
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_desfazer_fixo(p_fixo_id UUID, p_motivo TEXT DEFAULT 'Horário fixo encerrado') RETURNS INTEGER AS $$
DECLARE
  v_qtd INTEGER;
BEGIN
  UPDATE pilates_fixos SET ativo = FALSE, encerrado_em = now()
   WHERE id = p_fixo_id AND ativo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Horário fixo não encontrado ou já encerrado';
  END IF;

  UPDATE agendamentos a
     SET status = 'CANCELADO', motivo_cancelamento = p_motivo
    FROM horarios h
   WHERE h.id = a.horario_id
     AND a.fixo_id = p_fixo_id
     AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     AND h.inicio > now();
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Quando a clínica abre uma aula de pilates, reserva os alunos fixos dela
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_horario_novo_reserva_fixos() RETURNS TRIGGER AS $$
DECLARE
  v_fixo RECORD;
BEGIN
  IF NEW.modalidade <> 'PILATES' OR NEW.inicio <= now() OR NEW.bloqueado THEN
    RETURN NULL;
  END IF;

  FOR v_fixo IN
    SELECT id FROM pilates_fixos
     WHERE ativo
       AND dia_semana = fn_dia_semana(NEW.inicio)
       AND hora = fn_hora_local(NEW.inicio)
     ORDER BY criado_em
  LOOP
    PERFORM fn_agendar_aula_fixa(v_fixo.id, NEW.id);
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_horario_novo_reserva_fixos
  AFTER INSERT ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_horario_novo_reserva_fixos();

-- -----------------------------------------------------------------------------
-- Quem deixa de estar matriculado (alta, interrupção...) perde os fixos
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_paciente_encerra_fixos() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.situacao <> 'LIBERADO' AND OLD.situacao = 'LIBERADO' THEN
    UPDATE pilates_fixos SET ativo = FALSE, encerrado_em = now()
     WHERE paciente_id = NEW.id AND ativo;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_paciente_encerra_fixos
  AFTER UPDATE OF situacao ON pacientes
  FOR EACH ROW EXECUTE FUNCTION fn_paciente_encerra_fixos();

-- -----------------------------------------------------------------------------
-- Turmas de pilates que podem ser fixadas: dia da semana + hora com aulas
-- futuras abertas, com a menor quantidade de vagas entre elas
-- -----------------------------------------------------------------------------
CREATE VIEW vw_turmas_pilates AS
SELECT fn_dia_semana(v.inicio) AS dia_semana,
       fn_hora_local(v.inicio) AS hora,
       COUNT(*)                AS aulas_abertas,
       MIN(v.vagas_restantes)  AS menor_vaga,
       MIN(v.inicio)           AS proxima_aula
  FROM vw_horarios_vagas v
 WHERE v.modalidade = 'PILATES'
   AND v.inicio > now()
   AND NOT v.bloqueado
 GROUP BY 1, 2;

-- -----------------------------------------------------------------------------
-- Notificação de horário fixo
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_notificar_fixo(p_fixo_id UUID, p_destinatario papel_usuario, p_aulas INTEGER) RETURNS UUID AS $$
DECLARE
  v_fixo  pilates_fixos%ROWTYPE;
  v_nome  TEXT;
  v_dia   TEXT;
  v_tipo  tipo_notificacao;
  v_msg   TEXT;
  v_id    UUID;
BEGIN
  SELECT * INTO v_fixo FROM pilates_fixos WHERE id = p_fixo_id;
  SELECT nome_completo INTO v_nome FROM pacientes WHERE id = v_fixo.paciente_id;
  v_dia := (ARRAY['segundas', 'terças', 'quartas', 'quintas', 'sextas'])[v_fixo.dia_semana]
           || ' às ' || to_char(v_fixo.hora, 'HH24:MI');

  IF v_fixo.ativo THEN
    v_tipo := 'HORARIO_FIXO_DEFINIDO';
    v_msg := CASE WHEN p_destinatario = 'ADMIN'
      THEN format('%s fixou o pilates nas %s (%s aula(s) reservada(s))', v_nome, v_dia, p_aulas)
      ELSE format('Horário fixo de pilates definido: %s. %s aula(s) já reservada(s).', v_dia, p_aulas) END;
  ELSE
    v_tipo := 'HORARIO_FIXO_ENCERRADO';
    v_msg := CASE WHEN p_destinatario = 'ADMIN'
      THEN format('%s deixou o horário fixo de pilates das %s (%s aula(s) futura(s) cancelada(s))', v_nome, v_dia, p_aulas)
      ELSE format('Seu horário fixo de pilates das %s foi encerrado. %s aula(s) futura(s) cancelada(s).', v_dia, p_aulas) END;
  END IF;

  INSERT INTO notificacoes (destinatario, paciente_id, tipo, mensagem)
  VALUES (p_destinatario, v_fixo.paciente_id, v_tipo, v_msg)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
