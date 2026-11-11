-- =============================================================================
-- Banco de dados — App da Clínica de Fisioterapia e Pilates
-- PostgreSQL 13+ (testado no 16)
--
-- Como rodar:
--   createdb clinica
--   psql -d clinica -v ON_ERROR_STOP=1 -f 001_schema.sql
-- =============================================================================

BEGIN;

-- Extensão para impedir horários sobrepostos (EXCLUDE USING gist)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
CREATE TYPE papel_usuario       AS ENUM ('ADMIN', 'PACIENTE');
CREATE TYPE situacao_paciente   AS ENUM (
  'AGUARDANDO_AVALIACAO', 'LIBERADO', 'NAO_LIBERADO', 'ALTA', 'INTERROMPIDO'
);
CREATE TYPE modalidade          AS ENUM ('AVALIACAO', 'FISIOTERAPIA', 'PILATES');
CREATE TYPE status_agendamento  AS ENUM (
  'AGENDADO', 'CANCELAMENTO_SOLICITADO', 'CANCELADO', 'REALIZADO', 'FALTA'
);
CREATE TYPE resultado_avaliacao AS ENUM ('LIBERADO', 'NAO_LIBERADO');

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  senha_hash    VARCHAR(255) NOT NULL,
  papel         papel_usuario NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Módulo 1: pacientes
-- -----------------------------------------------------------------------------
CREATE TABLE pacientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      UUID NOT NULL UNIQUE REFERENCES usuarios(id),
  nome_completo   VARCHAR(150) NOT NULL,
  cpf             CHAR(11) NOT NULL UNIQUE CHECK (cpf ~ '^[0-9]{11}$'),
  data_nascimento DATE NOT NULL,
  telefone        VARCHAR(20) NOT NULL,
  endereco        VARCHAR(255),
  situacao        situacao_paciente NOT NULL DEFAULT 'AGUARDANDO_AVALIACAO',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico das mudanças de situação feitas pela cliente
-- (reabertura, alta, interrupção)
CREATE TABLE mudancas_situacao (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id       UUID NOT NULL REFERENCES pacientes(id),
  situacao_anterior situacao_paciente NOT NULL,
  situacao_nova     situacao_paciente NOT NULL,
  motivo            TEXT,
  alterado_por      UUID NOT NULL REFERENCES usuarios(id),
  alterado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (situacao_anterior <> situacao_nova)
);

CREATE INDEX idx_mudancas_paciente ON mudancas_situacao (paciente_id, alterado_em DESC);

-- -----------------------------------------------------------------------------
-- Módulo 2: agenda
-- -----------------------------------------------------------------------------
CREATE TABLE horarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade modalidade NOT NULL,
  inicio     TIMESTAMPTZ NOT NULL,
  fim        TIMESTAMPTZ NOT NULL,
  -- 4 vagas no pilates, 1 nas demais modalidades
  capacidade SMALLINT GENERATED ALWAYS AS (
    CASE WHEN modalidade = 'PILATES' THEN 4 ELSE 1 END
  ) STORED,
  bloqueado  BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  -- A mesma profissional atende tudo: horários não podem se sobrepor
  CONSTRAINT ex_horarios_sem_sobreposicao
    EXCLUDE USING gist (tstzrange(inicio, fim) WITH &&)
);

CREATE INDEX idx_horarios_inicio ON horarios (inicio);

CREATE TABLE agendamentos (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id                UUID NOT NULL REFERENCES pacientes(id),
  horario_id                 UUID NOT NULL REFERENCES horarios(id),
  experimental               BOOLEAN NOT NULL DEFAULT FALSE,
  status                     status_agendamento NOT NULL DEFAULT 'AGENDADO',
  cancelamento_solicitado_em TIMESTAMPTZ,
  motivo_cancelamento        TEXT,
  cancelamento_decidido_por  UUID REFERENCES usuarios(id),
  -- Pilates: a cliente libera reposição para uma aula cancelada com aviso
  reposicao_liberada         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Pilates: esta aula repõe a aula cancelada indicada aqui
  reposicao_de               UUID REFERENCES agendamentos(id),
  presenca_registrada_em     TIMESTAMPTZ,
  criado_em                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT reposicao_liberada OR status = 'CANCELADO'),
  CHECK (NOT (experimental AND reposicao_de IS NOT NULL)),
  CHECK (reposicao_de IS DISTINCT FROM id)
);

-- O mesmo paciente não ocupa duas vagas no mesmo horário
CREATE UNIQUE INDEX uq_agendamento_ativo_paciente_horario
  ON agendamentos (horario_id, paciente_id)
  WHERE status <> 'CANCELADO';

-- Uma aula experimental pendente ou feita por paciente.
-- Cancelada ou com falta não conta: o paciente pode marcar outra.
CREATE UNIQUE INDEX uq_aula_experimental_por_paciente
  ON agendamentos (paciente_id)
  WHERE experimental
    AND status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO', 'REALIZADO');

-- Cada reposição liberada é usada uma vez (se a reposição for cancelada, volta a valer)
CREATE UNIQUE INDEX uq_reposicao_usada_uma_vez
  ON agendamentos (reposicao_de)
  WHERE reposicao_de IS NOT NULL AND status <> 'CANCELADO';

CREATE INDEX idx_agendamentos_paciente ON agendamentos (paciente_id);
CREATE INDEX idx_agendamentos_horario  ON agendamentos (horario_id);

-- Resultado da avaliação inicial
CREATE TABLE avaliacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id    UUID NOT NULL REFERENCES pacientes(id),
  agendamento_id UUID NOT NULL UNIQUE REFERENCES agendamentos(id),
  resultado      resultado_avaliacao NOT NULL,
  observacoes    TEXT,
  avaliado_por   UUID NOT NULL REFERENCES usuarios(id),
  avaliado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_avaliacoes_paciente ON avaliacoes (paciente_id, avaliado_em DESC);

-- -----------------------------------------------------------------------------
-- Módulo 3: registro de atendimentos
-- agendamento_id é opcional: fisioterapia atendida fora do horário marcado
-- -----------------------------------------------------------------------------
CREATE TABLE registros_atendimento (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id      UUID NOT NULL REFERENCES pacientes(id),
  agendamento_id   UUID UNIQUE REFERENCES agendamentos(id),
  data_atendimento DATE NOT NULL,
  observacoes      TEXT,
  criado_por       UUID NOT NULL REFERENCES usuarios(id),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_registros_paciente_data
  ON registros_atendimento (paciente_id, data_atendimento DESC);

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

-- Horários com vagas restantes (o que o app mostra ao paciente)
CREATE VIEW vw_horarios_vagas AS
SELECT h.*,
       h.capacidade - COUNT(a.id) FILTER (WHERE a.status <> 'CANCELADO') AS vagas_restantes
  FROM horarios h
  LEFT JOIN agendamentos a ON a.horario_id = h.id
 GROUP BY h.id;

-- Alerta para a cliente: 2 ou mais faltas em aulas experimentais
CREATE VIEW vw_alerta_faltas_experimental AS
SELECT p.id          AS paciente_id,
       p.nome_completo,
       COUNT(*)      AS faltas_experimentais,
       MAX(h.inicio) AS ultima_falta,
       format('Paciente faltou %s vezes em aulas experimentais de pilates', COUNT(*)) AS observacao
  FROM agendamentos a
  JOIN horarios h  ON h.id = a.horario_id
  JOIN pacientes p ON p.id = a.paciente_id
 WHERE a.status = 'FALTA'
   AND a.experimental
 GROUP BY p.id, p.nome_completo
HAVING COUNT(*) >= 2;

-- -----------------------------------------------------------------------------
-- Gatilho: valida vagas, bloqueio, experimental, reposição e situação
-- a cada novo agendamento
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_valida_agendamento() RETURNS TRIGGER AS $$
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

  -- Reposição: só em pilates, de uma aula do próprio paciente cancelada e liberada pela cliente
  IF NEW.reposicao_de IS NOT NULL THEN
    IF v_modalidade <> 'PILATES' THEN
      RAISE EXCEPTION 'Reposição só existe para pilates';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM agendamentos o
        JOIN horarios oh ON oh.id = o.horario_id
       WHERE o.id = NEW.reposicao_de
         AND o.paciente_id = NEW.paciente_id
         AND oh.modalidade = 'PILATES'
         AND o.status = 'CANCELADO'
         AND o.reposicao_liberada
    ) THEN
      RAISE EXCEPTION 'Reposição não liberada pela cliente';
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

CREATE TRIGGER trg_valida_agendamento
  BEFORE INSERT ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION fn_valida_agendamento();

-- -----------------------------------------------------------------------------
-- Gatilho: mantém atualizado_em em dia
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_atualiza_timestamp() RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_atualizado_em
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_timestamp();

CREATE TRIGGER trg_pacientes_atualizado_em
  BEFORE UPDATE ON pacientes
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_timestamp();

CREATE TRIGGER trg_agendamentos_atualizado_em
  BEFORE UPDATE ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_timestamp();

CREATE TRIGGER trg_registros_atualizado_em
  BEFORE UPDATE ON registros_atendimento
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_timestamp();

-- -----------------------------------------------------------------------------
-- Funções de operação (cada uma roda numa única transação)
-- O backend chama estas funções em vez de montar os vários UPDATEs/INSERTs.
-- -----------------------------------------------------------------------------

-- Conclui a avaliação: marca o agendamento como REALIZADO, grava o resultado
-- e atualiza a situação do paciente.
CREATE FUNCTION fn_concluir_avaliacao(
  p_agendamento_id UUID,
  p_resultado      resultado_avaliacao,
  p_observacoes    TEXT,
  p_avaliado_por   UUID
) RETURNS UUID AS $$
DECLARE
  v_paciente_id UUID;
  v_avaliacao_id UUID;
BEGIN
  SELECT a.paciente_id INTO v_paciente_id
    FROM agendamentos a
    JOIN horarios h ON h.id = a.horario_id
   WHERE a.id = p_agendamento_id
     AND h.modalidade = 'AVALIACAO'
     AND a.status IN ('AGENDADO', 'REALIZADO')
     FOR UPDATE OF a;

  IF v_paciente_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento de avaliação não encontrado ou não pode ser concluído';
  END IF;

  UPDATE agendamentos
     SET status = 'REALIZADO',
         presenca_registrada_em = COALESCE(presenca_registrada_em, now())
   WHERE id = p_agendamento_id;

  INSERT INTO avaliacoes (paciente_id, agendamento_id, resultado, observacoes, avaliado_por)
  VALUES (v_paciente_id, p_agendamento_id, p_resultado, p_observacoes, p_avaliado_por)
  RETURNING id INTO v_avaliacao_id;

  UPDATE pacientes
     SET situacao = p_resultado::text::situacao_paciente
   WHERE id = v_paciente_id;

  RETURN v_avaliacao_id;
END;
$$ LANGUAGE plpgsql;

-- Aprova (ou recusa) um pedido de cancelamento.
-- p_liberar_reposicao só vale para aula de pilates regular.
CREATE FUNCTION fn_decidir_cancelamento(
  p_agendamento_id    UUID,
  p_aprovar           BOOLEAN,
  p_decidido_por      UUID,
  p_liberar_reposicao BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
DECLARE
  v_modalidade   modalidade;
  v_experimental BOOLEAN;
BEGIN
  SELECT h.modalidade, a.experimental INTO v_modalidade, v_experimental
    FROM agendamentos a
    JOIN horarios h ON h.id = a.horario_id
   WHERE a.id = p_agendamento_id
     AND a.status = 'CANCELAMENTO_SOLICITADO'
     FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há pedido de cancelamento pendente para este agendamento';
  END IF;

  IF p_liberar_reposicao AND (v_modalidade <> 'PILATES' OR v_experimental) THEN
    RAISE EXCEPTION 'Reposição só existe para aula de pilates regular';
  END IF;

  UPDATE agendamentos
     SET status = CASE WHEN p_aprovar THEN 'CANCELADO' ELSE 'AGENDADO' END::status_agendamento,
         cancelamento_decidido_por = p_decidido_por,
         reposicao_liberada = p_aprovar AND p_liberar_reposicao
   WHERE id = p_agendamento_id;
END;
$$ LANGUAGE plpgsql;

-- Muda a situação do paciente (só a cliente): reabrir, dar alta ou interromper.
-- Reabrir sempre leva a AGUARDANDO_AVALIACAO (nova avaliação).
-- Alta e interrupção cancelam os agendamentos futuros.
CREATE FUNCTION fn_mudar_situacao_paciente(
  p_paciente_id  UUID,
  p_nova         situacao_paciente,
  p_motivo       TEXT,
  p_alterado_por UUID
) RETURNS VOID AS $$
DECLARE
  v_atual situacao_paciente;
BEGIN
  SELECT situacao INTO v_atual FROM pacientes WHERE id = p_paciente_id FOR UPDATE;

  IF v_atual IS NULL THEN
    RAISE EXCEPTION 'Paciente não encontrado';
  END IF;

  IF p_nova = 'AGUARDANDO_AVALIACAO' THEN
    IF v_atual NOT IN ('NAO_LIBERADO', 'ALTA', 'INTERROMPIDO') THEN
      RAISE EXCEPTION 'Só é possível reabrir paciente não liberado, com alta ou interrompido';
    END IF;
  ELSIF p_nova IN ('ALTA', 'INTERROMPIDO') THEN
    IF v_atual <> 'LIBERADO' THEN
      RAISE EXCEPTION 'Alta ou interrupção só para paciente liberado';
    END IF;

    UPDATE agendamentos a
       SET status = 'CANCELADO',
           cancelamento_decidido_por = p_alterado_por,
           motivo_cancelamento = COALESCE(a.motivo_cancelamento, 'Paciente com ' || lower(p_nova::text))
      FROM horarios h
     WHERE h.id = a.horario_id
       AND a.paciente_id = p_paciente_id
       AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
       AND h.inicio > now();
  ELSE
    RAISE EXCEPTION 'Use fn_concluir_avaliacao para liberar ou não liberar o paciente';
  END IF;

  UPDATE pacientes SET situacao = p_nova WHERE id = p_paciente_id;

  INSERT INTO mudancas_situacao (paciente_id, situacao_anterior, situacao_nova, motivo, alterado_por)
  VALUES (p_paciente_id, v_atual, p_nova, p_motivo, p_alterado_por);
END;
$$ LANGUAGE plpgsql;

COMMIT;
