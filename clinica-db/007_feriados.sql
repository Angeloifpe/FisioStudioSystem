-- =============================================================================
-- 007 — Feriados e fim de semana: a clínica não abre, então não há atendimento
--   - tabela de feriados, já preenchida de 2026 a 2035 com:
--       * feriados nacionais (Lei 662/49, Lei 6.802/80, Lei 14.759/2023 e a
--         Paixão de Cristo, que muda de data todo ano)
--       * feriado estadual de Pernambuco: 6 de março, Data Magna (Lei 16.241/2017)
--     São João, Carnaval e feriados da cidade a cliente acrescenta quando quiser
--   - não deixa abrir horário em feriado
--   - ao cadastrar um feriado, cancela os atendimentos marcados naquele dia,
--     avisa cada paciente e libera a remarcação
--   - fim de semana: cancela os atendimentos futuros que ainda existiam no
--     sábado/domingo (vindos de antes da regra de segunda a sexta) e troca a
--     regra de segunda a sexta da 006 por um gatilho
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 007_feriados.sql
-- =============================================================================

BEGIN;

CREATE TABLE feriados (
  data      DATE PRIMARY KEY,
  nome      VARCHAR(120) NOT NULL,
  tipo      VARCHAR(20) NOT NULL CHECK (tipo IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL', 'FACULTATIVO', 'OUTRO')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Domingo de Páscoa (algoritmo gregoriano de Meeus/Jones/Butcher)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_pascoa(p_ano INTEGER) RETURNS DATE AS $$
DECLARE
  a INT := p_ano % 19;
  b INT := p_ano / 100;
  c INT := p_ano % 100;
  d INT := b / 4;
  e INT := b % 4;
  f INT := (b + 8) / 25;
  g INT := (b - f + 1) / 3;
  h INT := (19 * a + b - d - g + 15) % 30;
  i INT := c / 4;
  k INT := c % 4;
  l INT := (32 + 2 * e + 2 * i - h - k) % 7;
  m INT := (a + 11 * h + 22 * l) / 451;
BEGIN
  RETURN make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Cadastra os feriados nacionais e o estadual de Pernambuco de um ano
CREATE FUNCTION fn_gerar_feriados(p_ano INTEGER) RETURNS VOID AS $$
  INSERT INTO feriados (data, nome, tipo)
  SELECT make_date(p_ano, mes, dia), nome, tipo
    FROM (VALUES
      (1, 1, 'Confraternização Universal', 'NACIONAL'),
      (3, 6, 'Data Magna de Pernambuco', 'ESTADUAL'),
      (4, 21, 'Tiradentes', 'NACIONAL'),
      (5, 1, 'Dia do Trabalho', 'NACIONAL'),
      (9, 7, 'Independência do Brasil', 'NACIONAL'),
      (10, 12, 'Nossa Senhora Aparecida', 'NACIONAL'),
      (11, 2, 'Finados', 'NACIONAL'),
      (11, 15, 'Proclamação da República', 'NACIONAL'),
      (11, 20, 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'),
      (12, 25, 'Natal', 'NACIONAL')
    ) AS f(mes, dia, nome, tipo)
  UNION ALL
  SELECT fn_pascoa(p_ano) - 2, 'Paixão de Cristo', 'NACIONAL'
  ON CONFLICT (data) DO NOTHING;
$$ LANGUAGE sql;

DO $$ BEGIN PERFORM fn_gerar_feriados(ano) FROM generate_series(2026, 2035) AS ano; END $$;

-- -----------------------------------------------------------------------------
-- Segunda a sexta: a regra da 006 era uma CHECK, que também barrava atualizar
-- (bloquear) horários antigos de fim de semana. Vira um gatilho que só olha
-- horários novos ou com a data alterada.
-- -----------------------------------------------------------------------------
ALTER TABLE horarios DROP CONSTRAINT IF EXISTS ck_horarios_dias_uteis;

CREATE FUNCTION fn_horario_dia_util() RETURNS TRIGGER AS $$
BEGIN
  IF extract(isodow FROM NEW.inicio AT TIME ZONE 'America/Sao_Paulo') IN (6, 7) THEN
    RAISE EXCEPTION 'A clínica funciona de segunda a sexta';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_horario_dia_util
  BEFORE INSERT OR UPDATE OF inicio ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_horario_dia_util();

-- -----------------------------------------------------------------------------
-- Não deixa abrir horário em feriado
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_horario_nao_em_feriado() RETURNS TRIGGER AS $$
DECLARE
  v_nome TEXT;
BEGIN
  SELECT nome INTO v_nome FROM feriados
   WHERE data = (NEW.inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_nome IS NOT NULL THEN
    RAISE EXCEPTION 'A clínica não abre neste dia (feriado: %)', v_nome;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_horario_nao_em_feriado
  BEFORE INSERT OR UPDATE OF inicio ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_horario_nao_em_feriado();

-- -----------------------------------------------------------------------------
-- Nenhum agendamento em feriado ou fim de semana, mesmo que alguém
-- desbloqueie um horário antigo desses dias
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_agendamento_dia_aberto() RETURNS TRIGGER AS $$
DECLARE
  v_inicio TIMESTAMPTZ;
  v_nome   TEXT;
BEGIN
  SELECT inicio INTO v_inicio FROM horarios WHERE id = NEW.horario_id;
  IF extract(isodow FROM v_inicio AT TIME ZONE 'America/Sao_Paulo') IN (6, 7) THEN
    RAISE EXCEPTION 'A clínica funciona de segunda a sexta';
  END IF;
  SELECT nome INTO v_nome FROM feriados WHERE data = (v_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_nome IS NOT NULL THEN
    RAISE EXCEPTION 'A clínica não abre neste dia (feriado: %)', v_nome;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- O nome começa com "trg_a" para rodar antes do gatilho de validação (ordem alfabética)
CREATE TRIGGER trg_a_agendamento_dia_aberto
  BEFORE INSERT ON agendamentos
  FOR EACH ROW EXECUTE FUNCTION fn_agendamento_dia_aberto();

-- -----------------------------------------------------------------------------
-- Fecha um dia: cancela os atendimentos futuros dele (avisando cada paciente
-- com o motivo e liberando a remarcação), bloqueia os horários que tinham
-- agendamento e apaga os horários vazios. Devolve quantos foram cancelados.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_fechar_dia(p_data DATE, p_motivo TEXT, p_por UUID DEFAULT NULL) RETURNS INTEGER AS $$
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
    SELECT COUNT(*) INTO v_qtd FROM fn_cancelar_horarios(v_ids, p_por, p_motivo, TRUE, TRUE);
  END IF;

  -- Horários que nunca tiveram agendamento somem; os outros ficam bloqueados (histórico)
  DELETE FROM horarios h
   WHERE h.id = ANY (v_ids)
     AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.horario_id = h.id);
  UPDATE horarios SET bloqueado = TRUE WHERE id = ANY (v_ids);

  RETURN v_qtd;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- A cliente cadastra um feriado: fecha o dia e devolve quantos atendimentos
-- foram cancelados
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_adicionar_feriado(p_data DATE, p_nome TEXT, p_tipo TEXT, p_por UUID) RETURNS INTEGER AS $$
BEGIN
  INSERT INTO feriados (data, nome, tipo) VALUES (p_data, trim(p_nome), p_tipo);
  RETURN fn_fechar_dia(p_data, format('Feriado: %s. A clínica não abre neste dia.', trim(p_nome)), p_por);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Aplica as regras ao que já existe no banco
-- -----------------------------------------------------------------------------
-- (em bloco DO para não imprimir uma linha por dia na tela)
DO $$
DECLARE
  v_total INTEGER := 0;
  v_dia   RECORD;
BEGIN
  -- Feriados futuros já cadastrados
  FOR v_dia IN SELECT data, nome FROM feriados WHERE data >= current_date LOOP
    v_total := v_total + fn_fechar_dia(v_dia.data, format('Feriado: %s. A clínica não abre neste dia.', v_dia.nome));
  END LOOP;

  -- Fins de semana futuros que ainda tinham horário
  FOR v_dia IN
    SELECT DISTINCT (inicio AT TIME ZONE 'America/Sao_Paulo')::date AS data
      FROM horarios
     WHERE inicio > now()
       AND extract(isodow FROM inicio AT TIME ZONE 'America/Sao_Paulo') IN (6, 7)
  LOOP
    v_total := v_total + fn_fechar_dia(v_dia.data, 'A clínica não abre aos fins de semana.');
  END LOOP;

  RAISE NOTICE 'Atendimentos cancelados por feriado ou fim de semana: %', v_total;
END;
$$;

COMMIT;
