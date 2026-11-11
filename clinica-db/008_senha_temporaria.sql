-- =============================================================================
-- 008 — Troca de senha e senha temporária
--   - qualquer usuário logado pode trocar a própria senha (rota /auth/trocar-senha)
--   - a cliente pode gerar uma senha temporária para um paciente (ex.: esqueceu
--     a senha). A senha temporária vale por um prazo e, ao entrar com ela, o
--     paciente é obrigado a criar uma senha nova antes de usar o app
--
--   senha_temporaria_expira_em: NULL = senha normal;
--                               preenchida = senha temporária, válida até essa data
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 008_senha_temporaria.sql
-- =============================================================================

BEGIN;

ALTER TABLE usuarios
  ADD COLUMN senha_temporaria_expira_em TIMESTAMPTZ;

COMMENT ON COLUMN usuarios.senha_temporaria_expira_em IS
  'Preenchida quando a senha atual é temporária (gerada pela cliente); o usuário precisa trocá-la antes desse prazo';

COMMIT;
