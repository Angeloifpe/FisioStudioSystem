-- =============================================================================
-- 020 — "Sobre sua queixa": queixa principal, início dos sintomas e diagnóstico
-- =============================================================================
-- Antes de marcar a avaliação inicial, o paciente conta o que está sentindo.
-- A profissional lê isso para se preparar. Um registro por paciente, que ele
-- pode atualizar depois.
--
--   queixas_pacientes            uma linha por paciente
--   fn_salvar_queixa(...)        cria ou atualiza (valida tudo e devolve a linha)
-- =============================================================================

BEGIN;

CREATE TABLE queixas_pacientes (
  paciente_id         UUID PRIMARY KEY REFERENCES pacientes(id) ON DELETE CASCADE,
  queixa_principal    TEXT NOT NULL
                      CONSTRAINT ck_queixa_tamanho CHECK (char_length(btrim(queixa_principal)) BETWEEN 5 AND 500),
  inicio_sintomas     DATE NOT NULL,
  -- Diagnóstico clínico é opcional ("se houver"); quem marca "ainda não tenho" fica sem texto
  diagnostico_clinico TEXT
                      CONSTRAINT ck_queixa_diagnostico_tamanho CHECK (diagnostico_clinico IS NULL OR char_length(diagnostico_clinico) <= 500),
  sem_diagnostico     BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_queixa_sem_diagnostico CHECK (NOT (sem_diagnostico AND diagnostico_clinico IS NOT NULL))
);

CREATE TRIGGER trg_queixas_atualizado_em
  BEFORE UPDATE ON queixas_pacientes
  FOR EACH ROW EXECUTE FUNCTION fn_atualiza_timestamp();

-- A data dos sintomas não pode ser no futuro nem absurdamente antiga
CREATE FUNCTION fn_queixa_valida_data() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.inicio_sintomas > current_date THEN
    RAISE EXCEPTION 'A data de início dos sintomas não pode ser no futuro';
  END IF;
  IF NEW.inicio_sintomas < DATE '1900-01-01' THEN
    RAISE EXCEPTION 'Data de início dos sintomas inválida';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queixa_valida_data
  BEFORE INSERT OR UPDATE ON queixas_pacientes
  FOR EACH ROW EXECUTE FUNCTION fn_queixa_valida_data();

-- Cria ou atualiza a queixa do paciente
CREATE FUNCTION fn_salvar_queixa(
  p_paciente_id UUID,
  p_queixa TEXT,
  p_inicio DATE,
  p_diagnostico TEXT,
  p_sem_diagnostico BOOLEAN
) RETURNS queixas_pacientes AS $$
DECLARE
  v_linha queixas_pacientes;
  v_diag  TEXT := NULLIF(btrim(COALESCE(p_diagnostico, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pacientes WHERE id = p_paciente_id) THEN
    RAISE EXCEPTION 'Paciente não encontrado';
  END IF;
  IF p_sem_diagnostico THEN
    v_diag := NULL;   -- "ainda não tenho diagnóstico" limpa o texto
  END IF;

  INSERT INTO queixas_pacientes (paciente_id, queixa_principal, inicio_sintomas, diagnostico_clinico, sem_diagnostico)
  VALUES (p_paciente_id, btrim(p_queixa), p_inicio, v_diag, COALESCE(p_sem_diagnostico, FALSE))
  ON CONFLICT (paciente_id) DO UPDATE
     SET queixa_principal    = EXCLUDED.queixa_principal,
         inicio_sintomas     = EXCLUDED.inicio_sintomas,
         diagnostico_clinico = EXCLUDED.diagnostico_clinico,
         sem_diagnostico     = EXCLUDED.sem_diagnostico
  RETURNING * INTO v_linha;

  RETURN v_linha;
END;
$$ LANGUAGE plpgsql;

COMMIT;
