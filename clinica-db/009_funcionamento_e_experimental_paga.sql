-- =============================================================================
-- 009 — Regras dos áudios da cliente (05/11/2026)
--
-- 1. Horário de funcionamento por dia da semana (a cliente pode alterar):
--      segunda  06:00–11:00 e 16:00–19:10
--      terça    08:00–11:00 e 15:00–17:10
--      quarta   06:00–11:00            (à tarde não abre)
--      quinta   08:00–11:00 e 15:00–17:10
--      sexta    fechada
--    - horário novo (ou com a data alterada) precisa caber numa faixa do dia
--    - nenhum agendamento novo em horário fora do funcionamento
--    - horários futuros que já existiam fora do funcionamento: os vazios são
--      apagados e os que têm agendamento ficam bloqueados (os agendamentos
--      continuam; a cliente decide o que fazer — veja vw_horarios_fora_do_funcionamento)
--
-- 2. Aula experimental paga antes (pelo aplicativo ou via Pix):
--    - sem pagamento: se tiver um imprevisto, o paciente pode desmarcar e
--      marcar de novo; se faltar, pode marcar outra (como já era)
--    - com pagamento: marca uma vez e pronto. Não pode pedir para desmarcar
--      e, se faltar, a aula conta como dada (não marca outra experimental)
--    - a cliente registra o pagamento; se ela própria remarcar, o pagamento vai junto
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 009_funcionamento_e_experimental_paga.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Horário de funcionamento
-- -----------------------------------------------------------------------------
CREATE TABLE funcionamento (
  id         SERIAL PRIMARY KEY,
  dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7), -- 1 = segunda ... 7 = domingo
  abre       TIME NOT NULL,
  fecha      TIME NOT NULL,
  CONSTRAINT ck_funcionamento_faixa CHECK (fecha > abre),
  CONSTRAINT uq_funcionamento_faixa UNIQUE (dia_semana, abre)
);

COMMENT ON TABLE funcionamento IS
  'Faixas em que a clínica atende, por dia da semana. Dia sem faixa = fechado.';

INSERT INTO funcionamento (dia_semana, abre, fecha) VALUES
  (1, '06:00', '11:00'), (1, '16:00', '19:10'),
  (2, '08:00', '11:00'), (2, '15:00', '17:10'),
  (3, '06:00', '11:00'),
  (4, '08:00', '11:00'), (4, '15:00', '17:10');

-- Nome do dia para as mensagens
CREATE FUNCTION fn_nome_dia(p_dia SMALLINT) RETURNS TEXT AS $$
  SELECT (ARRAY['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira',
                'sexta-feira', 'sábado', 'domingo'])[p_dia];
$$ LANGUAGE sql IMMUTABLE;

-- O intervalo [inicio, fim) cabe inteiro numa faixa de funcionamento?
CREATE FUNCTION fn_dentro_do_funcionamento(p_inicio TIMESTAMPTZ, p_fim TIMESTAMPTZ) RETURNS BOOLEAN AS $$
  SELECT (p_inicio AT TIME ZONE 'America/Sao_Paulo')::date = (p_fim AT TIME ZONE 'America/Sao_Paulo')::date
     AND EXISTS (
       SELECT 1 FROM funcionamento f
        WHERE f.dia_semana = fn_dia_semana(p_inicio)
          AND f.abre  <= fn_hora_local(p_inicio)
          AND f.fecha >= fn_hora_local(p_fim)
     );
$$ LANGUAGE sql STABLE;

-- Descrição das faixas do dia, ex.: "06:00–11:00 e 16:00–19:10"
CREATE FUNCTION fn_faixas_do_dia(p_dia SMALLINT) RETURNS TEXT AS $$
  SELECT string_agg(to_char(abre, 'HH24:MI') || '–' || to_char(fecha, 'HH24:MI'), ' e ' ORDER BY abre)
    FROM funcionamento WHERE dia_semana = p_dia;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fn_horario_no_funcionamento() RETURNS TRIGGER AS $$
DECLARE
  v_dia    SMALLINT := fn_dia_semana(NEW.inicio);
  v_faixas TEXT;
BEGIN
  IF fn_dentro_do_funcionamento(NEW.inicio, NEW.fim) THEN
    RETURN NEW;
  END IF;
  v_faixas := fn_faixas_do_dia(v_dia);
  IF v_faixas IS NULL THEN
    RAISE EXCEPTION 'A clínica não abre na %', fn_nome_dia(v_dia);
  END IF;
  RAISE EXCEPTION 'Fora do horário de funcionamento: na % a clínica atende das %', fn_nome_dia(v_dia), v_faixas;
END;
$$ LANGUAGE plpgsql;

-- Roda depois de trg_horario_dia_util (ordem alfabética), que já recusa o fim de semana
CREATE TRIGGER trg_horario_funcionamento
  BEFORE INSERT OR UPDATE OF inicio, fim ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_horario_no_funcionamento();

-- Nenhum agendamento novo em horário fora do funcionamento (ex.: um antigo desbloqueado)
CREATE FUNCTION fn_agendamento_no_funcionamento() RETURNS TRIGGER AS $$
DECLARE
  v_inicio TIMESTAMPTZ;
  v_fim    TIMESTAMPTZ;
BEGIN
  SELECT inicio, fim INTO v_inicio, v_fim FROM horarios WHERE id = NEW.horario_id;
  IF v_inicio IS NOT NULL AND NOT fn_dentro_do_funcionamento(v_inicio, v_fim) THEN
    RAISE EXCEPTION 'Este horário está fora do horário de funcionamento da clínica';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- "trg_a..." para rodar antes do gatilho de validação (ordem alfabética)
CREATE TRIGGER trg_a_agendamento_no_funcionamento
  BEFORE INSERT ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION fn_agendamento_no_funcionamento();

-- Horários futuros que já existiam fora do funcionamento:
-- apaga os que nunca tiveram agendamento e bloqueia os que têm
DELETE FROM horarios h
 WHERE h.inicio > now()
   AND NOT fn_dentro_do_funcionamento(h.inicio, h.fim)
   AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.horario_id = h.id);

UPDATE horarios SET bloqueado = TRUE
 WHERE inicio > now()
   AND NOT bloqueado
   AND NOT fn_dentro_do_funcionamento(inicio, fim);

-- Para a cliente resolver: horários futuros fora do funcionamento com agendamentos ativos
CREATE VIEW vw_horarios_fora_do_funcionamento AS
SELECT h.id AS horario_id, h.modalidade, h.inicio, h.fim, h.bloqueado,
       COUNT(a.id) FILTER (WHERE a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')) AS agendamentos_ativos
  FROM horarios h
  LEFT JOIN agendamentos a ON a.horario_id = h.id
 WHERE h.inicio > now()
   AND NOT fn_dentro_do_funcionamento(h.inicio, h.fim)
 GROUP BY h.id
HAVING COUNT(a.id) FILTER (WHERE a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')) > 0;

-- -----------------------------------------------------------------------------
-- 2. Aula experimental paga antes
-- -----------------------------------------------------------------------------
CREATE TYPE forma_pagamento AS ENUM ('APLICATIVO', 'PIX');

ALTER TABLE agendamentos
  ADD COLUMN pago_em                  TIMESTAMPTZ,
  ADD COLUMN forma_pagamento          forma_pagamento,
  ADD COLUMN pagamento_registrado_por UUID REFERENCES usuarios(id),
  ADD CONSTRAINT ck_pagamento_completo CHECK ((pago_em IS NULL) = (forma_pagamento IS NULL));

-- Uma aula experimental pendente, feita ou paga e perdida por paciente.
-- Falta em aula paga conta como dada; falta ou cancelamento sem pagamento não contam.
DROP INDEX uq_aula_experimental_por_paciente;
CREATE UNIQUE INDEX uq_aula_experimental_por_paciente
  ON agendamentos (paciente_id)
  WHERE experimental
    AND (status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO', 'REALIZADO')
         OR (status = 'FALTA' AND pago_em IS NOT NULL));

-- A cliente registra que o paciente pagou a aula experimental antes da aula
CREATE FUNCTION fn_registrar_pagamento_experimental(
  p_agendamento_id UUID,
  p_forma          forma_pagamento,
  p_registrado_por UUID
) RETURNS VOID AS $$
DECLARE
  v_ag agendamentos%ROWTYPE;
BEGIN
  SELECT * INTO v_ag FROM agendamentos WHERE id = p_agendamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;
  IF NOT v_ag.experimental THEN
    RAISE EXCEPTION 'Pagamento antecipado só vale para aula experimental';
  END IF;
  IF v_ag.pago_em IS NOT NULL THEN
    RAISE EXCEPTION 'O pagamento desta aula já foi registrado';
  END IF;
  IF v_ag.status <> 'AGENDADO' THEN
    RAISE EXCEPTION 'Só é possível registrar o pagamento de uma aula experimental agendada (antes da aula)';
  END IF;

  UPDATE agendamentos
     SET pago_em = now(), forma_pagamento = p_forma, pagamento_registrado_por = p_registrado_por
   WHERE id = p_agendamento_id;
END;
$$ LANGUAGE plpgsql;

-- Aula experimental paga não pode ser desmarcada pelo paciente
CREATE FUNCTION fn_experimental_paga_nao_desmarca() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'CANCELAMENTO_SOLICITADO' AND OLD.status <> 'CANCELAMENTO_SOLICITADO'
     AND OLD.experimental AND OLD.pago_em IS NOT NULL THEN
    RAISE EXCEPTION 'Aula experimental paga não pode ser desmarcada nem remarcada; se o paciente não vier, ela conta como dada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_experimental_paga_nao_desmarca
  BEFORE UPDATE OF status ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION fn_experimental_paga_nao_desmarca();

-- Remarcação pela cliente: igual à da 003, agora levando o pagamento junto
CREATE OR REPLACE FUNCTION fn_remarcar_agendamento(
  p_agendamento_id   UUID,
  p_novo_horario_id  UUID,
  p_remarcado_por    UUID
) RETURNS UUID AS $$
DECLARE
  v_atual           agendamentos%ROWTYPE;
  v_modalidade      modalidade;
  v_nova_modalidade modalidade;
  v_novo_inicio     TIMESTAMPTZ;
  v_novo_id         UUID;
BEGIN
  SELECT a.* INTO v_atual
    FROM agendamentos a
   WHERE a.id = p_agendamento_id
     AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado ou já cancelado/realizado';
  END IF;

  IF v_atual.horario_id = p_novo_horario_id THEN
    RAISE EXCEPTION 'O novo horário é igual ao atual';
  END IF;

  SELECT modalidade INTO v_modalidade FROM horarios WHERE id = v_atual.horario_id;
  SELECT modalidade, inicio INTO v_nova_modalidade, v_novo_inicio FROM horarios WHERE id = p_novo_horario_id;

  IF v_nova_modalidade IS NULL THEN
    RAISE EXCEPTION 'Novo horário não encontrado';
  END IF;
  IF v_nova_modalidade <> v_modalidade THEN
    RAISE EXCEPTION 'Só é possível remarcar para um horário da mesma modalidade';
  END IF;
  IF v_novo_inicio <= now() THEN
    RAISE EXCEPTION 'O novo horário já passou';
  END IF;

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_decidido_por = p_remarcado_por,
         motivo_cancelamento = 'Remarcado pela clínica'
   WHERE id = p_agendamento_id;

  -- O gatilho trg_valida_agendamento confere vagas, bloqueio e situação
  INSERT INTO agendamentos (paciente_id, horario_id, experimental, reposicao_de, remarcado_de,
                            pago_em, forma_pagamento, pagamento_registrado_por)
  VALUES (v_atual.paciente_id, p_novo_horario_id, v_atual.experimental, v_atual.reposicao_de, p_agendamento_id,
          v_atual.pago_em, v_atual.forma_pagamento, v_atual.pagamento_registrado_por)
  RETURNING id INTO v_novo_id;

  RETURN v_novo_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
