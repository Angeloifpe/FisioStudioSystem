-- =============================================================================
-- 003 — Ajustes da cliente na agenda
--   - cancelar um agendamento por conta própria
--   - remarcar um paciente para outro horário (guarda o histórico)
--
--   psql -d clinica -v ON_ERROR_STOP=1 -f 003_ajustes_cliente.sql
-- =============================================================================

BEGIN;

-- Liga o agendamento novo ao antigo quando a cliente remarca
ALTER TABLE agendamentos
  ADD COLUMN remarcado_de UUID REFERENCES agendamentos(id);

-- Um agendamento só pode ser remarcado uma vez (o novo pode ser remarcado de novo)
CREATE UNIQUE INDEX uq_remarcado_de
  ON agendamentos (remarcado_de)
  WHERE remarcado_de IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Cancelamento feito pela cliente (sem pedido do paciente)
-- p_liberar_reposicao só vale para aula de pilates regular.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_cancelar_pela_clinica(
  p_agendamento_id    UUID,
  p_cancelado_por     UUID,
  p_motivo            TEXT DEFAULT NULL,
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
     AND a.status IN ('AGENDADO', 'CANCELAMENTO_SOLICITADO')
     FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado ou já cancelado/realizado';
  END IF;

  IF p_liberar_reposicao AND (v_modalidade <> 'PILATES' OR v_experimental) THEN
    RAISE EXCEPTION 'Reposição só existe para aula de pilates regular';
  END IF;

  UPDATE agendamentos
     SET status = 'CANCELADO',
         cancelamento_decidido_por = p_cancelado_por,
         motivo_cancelamento = COALESCE(p_motivo, motivo_cancelamento, 'Cancelado pela clínica'),
         reposicao_liberada = p_liberar_reposicao
   WHERE id = p_agendamento_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Remarcação feita pela cliente: cancela o agendamento atual e cria outro
-- no novo horário, mantendo experimental/reposição. Tudo numa transação:
-- se o novo horário não puder ser usado (sem vaga, bloqueado...), nada muda.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_remarcar_agendamento(
  p_agendamento_id   UUID,
  p_novo_horario_id  UUID,
  p_remarcado_por    UUID
) RETURNS UUID AS $$
DECLARE
  v_atual          agendamentos%ROWTYPE;
  v_modalidade     modalidade;
  v_nova_modalidade modalidade;
  v_novo_inicio    TIMESTAMPTZ;
  v_novo_id        UUID;
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
  INSERT INTO agendamentos (paciente_id, horario_id, experimental, reposicao_de, remarcado_de)
  VALUES (v_atual.paciente_id, p_novo_horario_id, v_atual.experimental, v_atual.reposicao_de, p_agendamento_id)
  RETURNING id INTO v_novo_id;

  RETURN v_novo_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
