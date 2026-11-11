-- =============================================================================
-- 011 — Sessão de fisioterapia sem duração definida = 30 minutos
--   - paciente novo começa com sessão de 30 min; se a dele for mais longa,
--     a cliente muda no cadastro do paciente (30 a 60 min)
--   - quem ainda estava com o padrão anterior (60 min, da 010) passa para 30:
--     a 010 acabou de entrar e a cliente ainda não tinha definido ninguém
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 011_duracao_fisio_padrao_30.sql
-- =============================================================================

BEGIN;

ALTER TABLE pacientes ALTER COLUMN duracao_fisioterapia_min SET DEFAULT 30;

UPDATE pacientes SET duracao_fisioterapia_min = 30 WHERE duracao_fisioterapia_min = 60;

COMMENT ON COLUMN pacientes.duracao_fisioterapia_min IS
  'Quanto dura a sessão de fisioterapia deste paciente (30 a 60 min, de 5 em 5; padrão 30), definido pela cliente';

COMMIT;
