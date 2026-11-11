-- =============================================================================
-- 010 — Grade das aulas de pilates e duração da fisioterapia por paciente
--
-- 1. Grade fixa das aulas de pilates (tabela enviada pela cliente):
--      horário        seg  ter  qua  qui
--      06:00–07:00     x         x
--      08:00–09:00     x    x    x
--      08:30–09:30                    x
--      09:00–10:00     x    x    x
--      09:30–10:30                    x
--      15:00–16:00          x         x
--      16:00–17:00     x    x         x
--      17:10–18:10     x    x         x
--      18:10–19:10     x    x         x
--    - aula de pilates só pode ser aberta num horário da grade
--    - fisioterapia e avaliação não podem cair no horário de uma aula da grade
--      (mesmo que a aula ainda não tenha sido aberta)
--    - fn_abrir_aulas_pilates(de, ate) abre todas as aulas da grade no período
--    - como há aulas até 19:10 na terça e na quinta, a tarde desses dias passa
--      a ser 15:00–19:10 (antes, 15:00–17:10, entendido do áudio)
--
-- 2. Duração da sessão de fisioterapia por paciente (30 a 60 minutos),
--    definida pela cliente. O paciente escolhe só o início: o sistema cria o
--    horário com a duração dele, se couber no funcionamento, fora das aulas de
--    pilates e sem bater com outro atendimento.
--    - fn_inicios_fisioterapia(data, duracao): inícios livres no dia (de 10 em 10 min)
--    - fn_agendar_fisioterapia(paciente, inicio): cria o horário e o agendamento
--    - fn_remarcar_fisioterapia(agendamento, inicio, por): a cliente muda o início
--    - se o atendimento for cancelado, o horário criado para ele é liberado
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 010_grade_pilates_e_duracao_fisio.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Funcionamento: terça e quinta à tarde até 19:10 (tem aula de pilates até lá)
-- -----------------------------------------------------------------------------
UPDATE funcionamento SET fecha = '19:10'
 WHERE dia_semana IN (2, 4) AND abre = '15:00' AND fecha = '17:10';

-- -----------------------------------------------------------------------------
-- 1. Grade das aulas de pilates
-- -----------------------------------------------------------------------------
CREATE TABLE pilates_grade (
  id         SERIAL PRIMARY KEY,
  dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7), -- 1 = segunda
  inicio     TIME NOT NULL,
  fim        TIME NOT NULL,
  CONSTRAINT ck_pilates_grade_faixa CHECK (fim > inicio),
  CONSTRAINT uq_pilates_grade_aula UNIQUE (dia_semana, inicio)
);

COMMENT ON TABLE pilates_grade IS
  'Aulas de pilates da semana. Nesses horários não se marca fisioterapia nem avaliação.';

INSERT INTO pilates_grade (dia_semana, inicio, fim) VALUES
  (1, '06:00', '07:00'), (1, '08:00', '09:00'), (1, '09:00', '10:00'),
  (1, '16:00', '17:00'), (1, '17:10', '18:10'), (1, '18:10', '19:10'),
  (2, '08:00', '09:00'), (2, '09:00', '10:00'), (2, '15:00', '16:00'),
  (2, '16:00', '17:00'), (2, '17:10', '18:10'), (2, '18:10', '19:10'),
  (3, '06:00', '07:00'), (3, '08:00', '09:00'), (3, '09:00', '10:00'),
  (4, '08:30', '09:30'), (4, '09:30', '10:30'), (4, '15:00', '16:00'),
  (4, '16:00', '17:00'), (4, '17:10', '18:10'), (4, '18:10', '19:10');

-- O horário respeita a grade? Pilates: é uma aula da grade. Outras modalidades:
-- não bate com nenhuma aula da grade naquele dia da semana.
CREATE FUNCTION fn_respeita_grade_pilates(p_modalidade modalidade, p_inicio TIMESTAMPTZ, p_fim TIMESTAMPTZ)
RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN p_modalidade = 'PILATES' THEN EXISTS (
      SELECT 1 FROM pilates_grade g
       WHERE g.dia_semana = fn_dia_semana(p_inicio)
         AND g.inicio = fn_hora_local(p_inicio)
         AND g.fim    = fn_hora_local(p_fim))
    ELSE NOT EXISTS (
      SELECT 1 FROM pilates_grade g
       WHERE g.dia_semana = fn_dia_semana(p_inicio)
         AND g.inicio < fn_hora_local(p_fim)
         AND g.fim    > fn_hora_local(p_inicio))
  END;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fn_aulas_do_dia(p_dia SMALLINT) RETURNS TEXT AS $$
  SELECT string_agg(to_char(inicio, 'HH24:MI') || '–' || to_char(fim, 'HH24:MI'), ', ' ORDER BY inicio)
    FROM pilates_grade WHERE dia_semana = p_dia;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fn_horario_na_grade() RETURNS TRIGGER AS $$
DECLARE
  v_dia  SMALLINT := fn_dia_semana(NEW.inicio);
  v_aula pilates_grade%ROWTYPE;
BEGIN
  IF fn_respeita_grade_pilates(NEW.modalidade, NEW.inicio, NEW.fim) THEN
    RETURN NEW;
  END IF;
  IF NEW.modalidade = 'PILATES' THEN
    RAISE EXCEPTION 'Aula de pilates fora da grade: na % as aulas são %',
      fn_nome_dia(v_dia), COALESCE(fn_aulas_do_dia(v_dia), 'nenhuma');
  END IF;
  SELECT * INTO v_aula FROM pilates_grade g
   WHERE g.dia_semana = v_dia AND g.inicio < fn_hora_local(NEW.fim) AND g.fim > fn_hora_local(NEW.inicio)
   ORDER BY g.inicio LIMIT 1;
  RAISE EXCEPTION 'Neste horário tem aula de pilates (% às %)',
    to_char(v_aula.inicio, 'HH24:MI'), to_char(v_aula.fim, 'HH24:MI');
END;
$$ LANGUAGE plpgsql;

-- Roda depois de trg_horario_funcionamento (ordem alfabética)
CREATE TRIGGER trg_horario_grade_pilates
  BEFORE INSERT OR UPDATE OF inicio, fim, modalidade ON horarios
  FOR EACH ROW EXECUTE FUNCTION fn_horario_na_grade();

-- Agendamento novo: além do funcionamento (009), fisioterapia e avaliação não
-- podem cair em aula da grade (ex.: um horário antigo desbloqueado)
CREATE OR REPLACE FUNCTION fn_agendamento_no_funcionamento() RETURNS TRIGGER AS $$
DECLARE
  v_h horarios%ROWTYPE;
BEGIN
  SELECT * INTO v_h FROM horarios WHERE id = NEW.horario_id;
  IF v_h.id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT fn_dentro_do_funcionamento(v_h.inicio, v_h.fim) THEN
    RAISE EXCEPTION 'Este horário está fora do horário de funcionamento da clínica';
  END IF;
  IF v_h.modalidade <> 'PILATES' AND NOT fn_respeita_grade_pilates(v_h.modalidade, v_h.inicio, v_h.fim) THEN
    RAISE EXCEPTION 'Neste horário tem aula de pilates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Abre todas as aulas da grade no período (pula feriados e o que já existe ou
-- bate com outro horário). Devolve quantas aulas foram abertas.
CREATE FUNCTION fn_abrir_aulas_pilates(p_de DATE, p_ate DATE) RETURNS INTEGER AS $$
DECLARE
  v_aula   RECORD;
  v_abertas INTEGER := 0;
BEGIN
  IF p_ate < p_de THEN
    RAISE EXCEPTION 'A data final precisa ser depois da inicial';
  END IF;
  IF p_ate - p_de > 120 THEN
    RAISE EXCEPTION 'Abra no máximo 120 dias de cada vez';
  END IF;

  FOR v_aula IN
    SELECT (d::date + g.inicio) AT TIME ZONE 'America/Sao_Paulo' AS inicio,
           (d::date + g.fim)    AT TIME ZONE 'America/Sao_Paulo' AS fim
      FROM generate_series(p_de, p_ate, INTERVAL '1 day') d
      JOIN pilates_grade g ON g.dia_semana = extract(isodow FROM d)
     WHERE NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = d::date)
     ORDER BY 1
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM horarios h
       WHERE NOT h.cancelado AND tstzrange(h.inicio, h.fim) && tstzrange(v_aula.inicio, v_aula.fim));
    BEGIN
      INSERT INTO horarios (modalidade, inicio, fim) VALUES ('PILATES', v_aula.inicio, v_aula.fim);
      v_abertas := v_abertas + 1;
    EXCEPTION WHEN raise_exception OR exclusion_violation THEN
      NULL; -- fora do funcionamento, sobreposto...: pula
    END;
  END LOOP;
  RETURN v_abertas;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Horários criados sob demanda (fisioterapia com a duração do paciente).
-- Cancelado o atendimento, o horário fica "cancelado" e libera o tempo.
-- -----------------------------------------------------------------------------
ALTER TABLE horarios
  ADD COLUMN sob_demanda BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cancelado   BOOLEAN NOT NULL DEFAULT FALSE;

-- Horário cancelado não ocupa a agenda
ALTER TABLE horarios DROP CONSTRAINT ex_horarios_sem_sobreposicao;
ALTER TABLE horarios ADD CONSTRAINT ex_horarios_sem_sobreposicao
  EXCLUDE USING gist (tstzrange(inicio, fim) WITH &&) WHERE (NOT cancelado);

-- Horários futuros que já existiam fora da grade (pilates fora da grade, ou
-- fisioterapia/avaliação em horário de aula): apaga os vazios e bloqueia os que
-- têm agendamento (os agendamentos continuam; a cliente decide)
DELETE FROM horarios h
 WHERE h.inicio > now()
   AND NOT fn_respeita_grade_pilates(h.modalidade, h.inicio, h.fim)
   AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.horario_id = h.id);

UPDATE horarios SET bloqueado = TRUE
 WHERE inicio > now()
   AND NOT bloqueado
   AND NOT fn_respeita_grade_pilates(modalidade, inicio, fim);

-- A view da 009 passa a listar também os horários fora da grade, com o motivo
DROP VIEW vw_horarios_fora_do_funcionamento;
CREATE VIEW vw_horarios_fora_do_funcionamento AS
SELECT h.id AS horario_id, h.modalidade, h.inicio, h.fim, h.bloqueado,
       CASE WHEN NOT fn_dentro_do_funcionamento(h.inicio, h.fim) THEN 'FORA_DO_FUNCIONAMENTO'
            WHEN h.modalidade = 'PILATES' THEN 'PILATES_FORA_DA_GRADE'
            ELSE 'NO_HORARIO_DE_AULA_DE_PILATES' END AS motivo,
       COUNT(a.id) FILTER (WHERE a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')) AS agendamentos_ativos
  FROM horarios h
  LEFT JOIN agendamentos a ON a.horario_id = h.id
 WHERE h.inicio > now()
   AND NOT h.cancelado
   AND (NOT fn_dentro_do_funcionamento(h.inicio, h.fim)
        OR NOT fn_respeita_grade_pilates(h.modalidade, h.inicio, h.fim))
 GROUP BY h.id
HAVING COUNT(a.id) FILTER (WHERE a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')) > 0;

-- -----------------------------------------------------------------------------
-- 2. Duração da fisioterapia por paciente
-- -----------------------------------------------------------------------------
ALTER TABLE pacientes
  ADD COLUMN duracao_fisioterapia_min SMALLINT NOT NULL DEFAULT 60,
  ADD CONSTRAINT ck_pacientes_duracao_fisio
    CHECK (duracao_fisioterapia_min BETWEEN 30 AND 60 AND duracao_fisioterapia_min % 5 = 0);

COMMENT ON COLUMN pacientes.duracao_fisioterapia_min IS
  'Quanto dura a sessão de fisioterapia deste paciente (30 a 60 min, de 5 em 5), definido pela cliente';

-- Inícios livres para uma sessão de p_duracao minutos no dia (de 10 em 10 min):
-- dentro do funcionamento, fora das aulas da grade, sem bater com outro
-- horário, sem feriado e ainda no futuro.
CREATE FUNCTION fn_inicios_fisioterapia(p_data DATE, p_duracao INTEGER)
RETURNS TABLE (inicio TIMESTAMPTZ, fim TIMESTAMPTZ) AS $$
  SELECT s.s, s.s + make_interval(mins => p_duracao)
    FROM funcionamento f
   CROSS JOIN LATERAL generate_series(
           (p_data + f.abre) AT TIME ZONE 'America/Sao_Paulo',
           ((p_data + f.fecha) AT TIME ZONE 'America/Sao_Paulo') - make_interval(mins => p_duracao),
           INTERVAL '10 minutes') AS s(s)
   WHERE f.dia_semana = extract(isodow FROM p_data)
     AND s.s > now()
     AND NOT EXISTS (SELECT 1 FROM feriados fe WHERE fe.data = p_data)
     AND NOT EXISTS (
       SELECT 1 FROM pilates_grade g
        WHERE g.dia_semana = f.dia_semana
          AND (p_data + g.inicio) AT TIME ZONE 'America/Sao_Paulo' < s.s + make_interval(mins => p_duracao)
          AND (p_data + g.fim)    AT TIME ZONE 'America/Sao_Paulo' > s.s)
     AND NOT EXISTS (
       SELECT 1 FROM horarios h
        WHERE NOT h.cancelado
          AND tstzrange(h.inicio, h.fim) && tstzrange(s.s, s.s + make_interval(mins => p_duracao)))
   ORDER BY s.s;
$$ LANGUAGE sql STABLE;

-- Cria o horário de fisioterapia com a duração do paciente e o agendamento.
-- Os gatilhos conferem funcionamento, grade de pilates, feriado, sobreposição e situação.
CREATE FUNCTION fn_agendar_fisioterapia(
  p_paciente_id  UUID,
  p_inicio       TIMESTAMPTZ,
  p_duracao      INTEGER DEFAULT NULL,  -- vazio: a duração cadastrada do paciente
  p_reposicao_de UUID DEFAULT NULL,
  p_remarcado_de UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_duracao INTEGER;
  v_horario UUID;
  v_id      UUID;
BEGIN
  SELECT COALESCE(p_duracao, duracao_fisioterapia_min) INTO v_duracao
    FROM pacientes WHERE id = p_paciente_id;
  IF v_duracao IS NULL THEN
    RAISE EXCEPTION 'Paciente não encontrado';
  END IF;
  IF v_duracao NOT BETWEEN 30 AND 60 THEN
    RAISE EXCEPTION 'A sessão de fisioterapia dura de 30 a 60 minutos';
  END IF;
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'Este horário já passou';
  END IF;

  INSERT INTO horarios (modalidade, inicio, fim, sob_demanda)
  VALUES ('FISIOTERAPIA', p_inicio, p_inicio + make_interval(mins => v_duracao), TRUE)
  RETURNING id INTO v_horario;

  INSERT INTO agendamentos (paciente_id, horario_id, reposicao_de, remarcado_de)
  VALUES (p_paciente_id, v_horario, p_reposicao_de, p_remarcado_de)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Atendimento cancelado num horário sob demanda: libera o tempo na agenda
CREATE FUNCTION fn_libera_horario_sob_demanda() RETURNS TRIGGER AS $$
BEGIN
  UPDATE horarios h
     SET cancelado = TRUE, bloqueado = TRUE
   WHERE h.id = NEW.horario_id
     AND h.sob_demanda
     AND NOT h.cancelado
     AND NOT EXISTS (
       SELECT 1 FROM agendamentos a
        WHERE a.horario_id = h.id AND a.status <> 'CANCELADO');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_libera_horario_sob_demanda
  AFTER UPDATE OF status ON agendamentos
  FOR EACH ROW
  WHEN (NEW.status = 'CANCELADO' AND OLD.status IS DISTINCT FROM 'CANCELADO')
  EXECUTE FUNCTION fn_libera_horario_sob_demanda();

-- A cliente muda o início de uma fisioterapia (mantém a duração da sessão)
CREATE FUNCTION fn_remarcar_fisioterapia(
  p_agendamento_id UUID,
  p_novo_inicio    TIMESTAMPTZ,
  p_remarcado_por  UUID
) RETURNS UUID AS $$
DECLARE
  v_atual   agendamentos%ROWTYPE;
  v_h       horarios%ROWTYPE;
  v_duracao INTEGER;
BEGIN
  SELECT a.* INTO v_atual FROM agendamentos a
   WHERE a.id = p_agendamento_id AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado ou já cancelado/realizado';
  END IF;

  SELECT * INTO v_h FROM horarios WHERE id = v_atual.horario_id;
  IF v_h.modalidade <> 'FISIOTERAPIA' THEN
    RAISE EXCEPTION 'Só a fisioterapia é remarcada pelo início; nas outras escolha um horário aberto';
  END IF;
  v_duracao := extract(epoch FROM v_h.fim - v_h.inicio)::INTEGER / 60;

  -- Cancela primeiro: se o horário era sob demanda, o tempo é liberado
  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_decidido_por = p_remarcado_por,
         motivo_cancelamento = 'Remarcado pela clínica'
   WHERE id = p_agendamento_id;

  RETURN fn_agendar_fisioterapia(v_atual.paciente_id, p_novo_inicio, v_duracao,
                                 v_atual.reposicao_de, p_agendamento_id);
END;
$$ LANGUAGE plpgsql;

COMMIT;
