import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import { query, queryOne, transacao } from '../db';
import { ErroHttp, naoEncontrado } from '../erros';
import { autenticar, pacienteDe, somente, usuarioDe } from '../middlewares/auth';

/** Módulo 2 — agendamentos, atendimentos e a interação paciente ↔ cliente. */
export const agendamentosRoutes = Router();
agendamentosRoutes.use(autenticar);

const camposAgendamento = `
  a.id, a.paciente_id, a.horario_id, h.modalidade, h.inicio, h.fim,
  a.status, a.experimental, a.avaliacao_para, a.reposicao_de, a.reposicao_liberada, a.remarcado_de, a.fixo_id,
  a.presenca_confirmada_em, a.cancelamento_solicitado_em, a.motivo_cancelamento, a.cancelado_fora_do_prazo,
  a.presenca_registrada_em, a.pago_em, a.forma_pagamento,
  (a.experimental AND a.pago_em IS NOT NULL AND a.status = 'FALTA') AS conta_como_dada, a.criado_em,
  (SELECT ho.inicio FROM agendamentos ao JOIN horarios ho ON ho.id = ao.horario_id
    WHERE ao.id = a.reposicao_de) AS reposicao_de_inicio`;

async function buscarAgendamento(c: PoolClient, id: string) {
  const r = await c.query(
    `SELECT ${camposAgendamento} FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function notificar(c: PoolClient, tipo: string, agendamentoId: string) {
  await c.query('SELECT fn_notificar_agendamento($1, $2)', [tipo, agendamentoId]);
}

const avaliacoesPara = ['PILATES', 'FISIOTERAPIA', 'AMBAS'] as const;

const novoAgendamento = z.object({
  horario_id: z.string().uuid(),
  experimental: z.boolean().default(false),
  reposicao_de: z.string().uuid().optional(),
  /** Atendimento que o paciente acabou de cancelar e está remarcando (liga os dois para a cliente). */
  remarcado_de: z.string().uuid().optional(),
  /** Obrigatório na avaliação: para qual modalidade ela é (uma avaliação por modalidade). */
  avaliacao_para: z.enum(['PILATES', 'FISIOTERAPIA'], {
    message: 'Escolha a avaliação: PILATES ou FISIOTERAPIA (para as duas, marque uma avaliação de cada)',
  }).optional(),
});

/** Confere que o atendimento remarcado é do paciente, está cancelado e é da mesma modalidade. */
async function conferirRemarcadoDe(c: PoolClient, pacienteId: string, remarcadoDe: string, modalidade: string) {
  const r = await c.query(
    `SELECT 1 FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
      WHERE a.id = $1 AND a.paciente_id = $2 AND a.status = 'CANCELADO' AND h.modalidade = $3`,
    [remarcadoDe, pacienteId, modalidade],
  );
  if (r.rowCount === 0) throw new ErroHttp(422, 'O atendimento que você está remarcando não foi encontrado ou não está cancelado');
}

/** Cria o agendamento; as regras (vagas, situação, experimental, reposição) são do banco. */
async function criarAgendamento(c: PoolClient, pacienteId: string, dados: z.infer<typeof novoAgendamento>) {
  const horario = await c.query('SELECT inicio, modalidade FROM horarios WHERE id = $1', [dados.horario_id]);
  if (horario.rowCount === 0) throw naoEncontrado('Horário');
  if (new Date(horario.rows[0].inicio) <= new Date()) {
    throw new ErroHttp(422, 'Este horário já passou');
  }
  if (horario.rows[0].modalidade === 'AVALIACAO' && !dados.avaliacao_para) {
    throw new ErroHttp(400, 'Escolha para qual modalidade é a avaliação (avaliacao_para): PILATES ou FISIOTERAPIA');
  }
  if (dados.remarcado_de) await conferirRemarcadoDe(c, pacienteId, dados.remarcado_de, horario.rows[0].modalidade);
  const r = await c.query(
    `INSERT INTO agendamentos (paciente_id, horario_id, experimental, reposicao_de, avaliacao_para, remarcado_de)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [pacienteId, dados.horario_id, dados.experimental, dados.reposicao_de ?? null, dados.avaliacao_para ?? null, dados.remarcado_de ?? null],
  );
  return r.rows[0].id as string;
}

const dataHora = z.string().datetime({ offset: true, message: 'Use data e hora ISO com fuso, ex.: 2026-11-03T14:00:00-03:00' });

// ===========================================================================
// Fisioterapia com a duração do paciente (paciente escolhe só o início)
// ===========================================================================

/**
 * Inícios livres para a fisioterapia num dia, com a duração do paciente:
 * dentro do funcionamento, fora das aulas de pilates e sem bater com outro atendimento.
 * Paciente: usa a própria duração. Cliente: informe paciente_id (ou duracao_min).
 */
agendamentosRoutes.get('/fisioterapia/inicios', async (req, res) => {
  const u = usuarioDe(req);
  const filtros = z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD'),
    paciente_id: z.string().uuid().optional(),
    duracao_min: z.coerce.number().int().min(30).max(60).optional(),
  }).parse(req.query);

  let duracao = filtros.duracao_min;
  const pacienteId = u.papel === 'PACIENTE' ? pacienteDe(req) : filtros.paciente_id;
  if (u.papel === 'PACIENTE' || (!duracao && pacienteId)) {
    const p = await queryOne<{ duracao_fisioterapia_min: number }>(
      'SELECT duracao_fisioterapia_min FROM pacientes WHERE id = $1', [pacienteId]);
    if (!p) throw naoEncontrado('Paciente');
    duracao = p.duracao_fisioterapia_min;
  }
  if (!duracao) throw new ErroHttp(400, 'Informe paciente_id ou duracao_min');

  const inicios = await query('SELECT inicio, fim FROM fn_inicios_fisioterapia($1::date, $2)', [filtros.data, duracao]);
  res.json({ data: filtros.data, duracao_min: duracao, inicios });
});

const novaFisioterapia = z.object({
  inicio: dataHora,
  reposicao_de: z.string().uuid().optional(),
  remarcado_de: z.string().uuid().optional(),
});

/** Paciente marca fisioterapia escolhendo o início; a duração é a cadastrada pela cliente. */
agendamentosRoutes.post('/fisioterapia', somente('PACIENTE'), async (req, res) => {
  const dados = novaFisioterapia.parse(req.body);
  const agendamento = await transacao(async (c) => {
    if (dados.remarcado_de) await conferirRemarcadoDe(c, pacienteDe(req), dados.remarcado_de, 'FISIOTERAPIA');
    const r = await c.query('SELECT fn_agendar_fisioterapia($1, $2, NULL, $3, $4) AS id', [
      pacienteDe(req), dados.inicio, dados.reposicao_de ?? null, dados.remarcado_de ?? null,
    ]);
    const id = r.rows[0].id as string;
    await notificar(c, dados.reposicao_de ? 'REPOSICAO_MARCADA' : 'AGENDAMENTO_CRIADO', id);
    return buscarAgendamento(c, id);
  });
  res.status(201).json(agendamento);
});

/** Cliente marca fisioterapia por um paciente (duracao_min opcional; padrão: a do paciente). */
agendamentosRoutes.post('/fisioterapia/pela-clinica', somente('ADMIN'), async (req, res) => {
  const dados = novaFisioterapia.extend({
    paciente_id: z.string().uuid(),
    duracao_min: z.number().int().min(30).max(60).optional(),
  }).parse(req.body);
  const agendamento = await transacao(async (c) => {
    const r = await c.query('SELECT fn_agendar_fisioterapia($1, $2, $3, $4) AS id', [
      dados.paciente_id, dados.inicio, dados.duracao_min ?? null, dados.reposicao_de ?? null,
    ]);
    const id = r.rows[0].id as string;
    await notificar(c, 'AGENDADO_PELA_CLINICA', id);
    return buscarAgendamento(c, id);
  });
  res.status(201).json(agendamento);
});

// ===========================================================================
// Paciente
// ===========================================================================

/**
 * Paciente agenda um horário (avisa a cliente).
 * - experimental: aula experimental de pilates (antes da avaliação)
 * - reposicao_de: id da aula de pilates cancelada cuja reposição a cliente liberou
 */
agendamentosRoutes.post('/', somente('PACIENTE'), async (req, res) => {
  const dados = novoAgendamento.parse(req.body);
  const pacienteId = pacienteDe(req);

  // Pilates não tem aula avulsa para o aluno: antes ele escolhe os dias e
  // horários fixos (as aulas das turmas são reservadas sozinhas); outra aula,
  // só usando uma remarcação
  if (!dados.experimental && !dados.reposicao_de) {
    const r = await queryOne<{ pilates: boolean; matriculado: boolean }>(
      `SELECT (SELECT modalidade = 'PILATES' FROM horarios WHERE id = $1) AS pilates,
              EXISTS (SELECT 1 FROM pilates_fixos WHERE paciente_id = $2 AND ativo) AS matriculado`,
      [dados.horario_id, pacienteId],
    );
    if (r?.pilates) {
      throw new ErroHttp(422, r.matriculado
        ? 'Você é matriculado(a) em turmas fixas: suas aulas já estão reservadas. Para outra aula, use uma remarcação.'
        : 'Antes de marcar aulas de pilates, escolha seus dias e horários fixos. Você pode mudar depois.');
    }
  }

  const agendamento = await transacao(async (c) => {
    const id = await criarAgendamento(c, pacienteId, dados);
    const tipo = dados.experimental ? 'AULA_EXPERIMENTAL_MARCADA'
      : dados.reposicao_de ? 'REPOSICAO_MARCADA'
      : 'AGENDAMENTO_CRIADO';
    await notificar(c, tipo, id);
    return buscarAgendamento(c, id);
  });
  res.status(201).json(agendamento);
});

/** Agendamentos do próprio paciente. */
agendamentosRoutes.get('/meus', somente('PACIENTE'), async (req, res) => {
  const agendamentos = await query(
    `SELECT ${camposAgendamento}
       FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
      WHERE a.paciente_id = $1
      ORDER BY h.inicio DESC`,
    [pacienteDe(req)],
  );
  res.json(agendamentos);
});

/**
 * Atendimentos cancelados com reposição/remarcação liberada e ainda não usada.
 * O paciente escolhe um horário da mesma modalidade e agenda com reposicao_de = id.
 */
agendamentosRoutes.get('/reposicoes-disponiveis', somente('PACIENTE'), async (req, res) => {
  const reposicoes = await query(
    `SELECT a.id, h.modalidade, h.inicio AS cancelado_em_horario_de, a.motivo_cancelamento
       FROM agendamentos a
       JOIN horarios h ON h.id = a.horario_id
      WHERE a.paciente_id = $1
        AND a.status = 'CANCELADO'
        AND a.reposicao_liberada
        AND NOT EXISTS (
          SELECT 1 FROM agendamentos r
           WHERE r.reposicao_de = a.id AND r.status <> 'CANCELADO'
        )
      ORDER BY h.inicio`,
    [pacienteDe(req)],
  );
  res.json(reposicoes);
});

/** Paciente confirma que vai comparecer (avisa a cliente). */
agendamentosRoutes.post('/:id/confirmar-presenca', somente('PACIENTE'), async (req, res) => {
  const pacienteId = pacienteDe(req);

  const agendamento = await transacao(async (c) => {
    const r = await c.query(
      `UPDATE agendamentos a
          SET presenca_confirmada_em = now()
         FROM horarios h
        WHERE a.id = $1
          AND a.paciente_id = $2
          AND h.id = a.horario_id
          AND a.status = 'AGENDADO'
          AND a.presenca_confirmada_em IS NULL
          AND h.inicio > now()
        RETURNING a.id`,
      [String(req.params.id), pacienteId],
    );
    if (r.rowCount === 0) {
      throw new ErroHttp(422, 'Só é possível confirmar um agendamento seu, ativo, ainda não confirmado e antes do horário');
    }
    await notificar(c, 'PRESENCA_CONFIRMADA', String(req.params.id));
    return buscarAgendamento(c, String(req.params.id));
  });
  res.json(agendamento);
});

/**
 * Paciente cancela o atendimento (sem esperar a decisão da cliente).
 * - Dentro do prazo (24 h por padrão): cancelado sem cobrança; no pilates regular
 *   ainda gera a remarcação.
 * - Fora do prazo: cancelado e a consulta é cobrada (conta como dada).
 * A resposta traz no_prazo e, no pilates, remarcacao_liberada. A cliente é
 * avisada e vê o cancelamento (dentro/fora do prazo) em "Pedidos".
 */
agendamentosRoutes.post('/:id/solicitar-cancelamento', somente('PACIENTE'), async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
  const pacienteId = pacienteDe(req);
  const id = String(req.params.id);

  const ag = await queryOne<{ modalidade: string; experimental: boolean }>(
    `SELECT h.modalidade, a.experimental FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
      WHERE a.id = $1 AND a.paciente_id = $2`,
    [id, pacienteId],
  );
  if (!ag) throw naoEncontrado('Agendamento');

  const pilatesRegular = ag.modalidade === 'PILATES' && !ag.experimental;
  const resultado = await transacao(async (c) => {
    const r = pilatesRegular
      ? await c.query('SELECT fn_avisar_falta_pilates($1, $2, $3) AS ok', [id, pacienteId, motivo ?? null])
      : await c.query('SELECT fn_cancelar_pelo_paciente($1, $2, $3) AS ok', [id, pacienteId, motivo ?? null]);
    const noPrazo = r.rows[0].ok as boolean;
    return {
      ...(await buscarAgendamento(c, id)),
      no_prazo: noPrazo,
      ...(pilatesRegular ? { remarcacao_liberada: noPrazo } : {}),
    };
  });
  res.json(resultado);
});

/**
 * Paciente remarca (fisioterapia, avaliação, aula experimental sem pagamento).
 * - fisioterapia: informe o novo início (inicio)
 * - avaliação e experimental: informe um horário aberto (horario_id)
 * O atendimento antigo é cancelado (dentro ou fora do prazo) e o novo fica ligado
 * a ele. Remarcar fora do prazo não tira a cobrança do atendimento antigo.
 * Pilates regular: cancele (aviso de falta) e use a remarcação liberada.
 */
agendamentosRoutes.post('/:id/remarcar-paciente', somente('PACIENTE'), async (req, res) => {
  const dados = z.object({ horario_id: z.string().uuid().optional(), inicio: dataHora.optional() })
    .refine((d) => Boolean(d.horario_id) !== Boolean(d.inicio), {
      message: 'Informe o horário (horario_id) ou o novo início (inicio), um dos dois',
      path: ['horario_id'],
    }).parse(req.body);
  const id = String(req.params.id);

  const resultado = await transacao(async (c) => {
    const r = await c.query('SELECT fn_remarcar_pelo_paciente($1, $2, $3, $4) AS id', [
      id, pacienteDe(req), dados.horario_id ?? null, dados.inicio ?? null,
    ]);
    const antigo = await buscarAgendamento(c, id);
    return { ...(await buscarAgendamento(c, r.rows[0].id as string)), antigo_fora_do_prazo: antigo?.cancelado_fora_do_prazo ?? false };
  });
  res.status(201).json(resultado);
});

// ===========================================================================
// Cliente (ADMIN)
// ===========================================================================

/** Agendamentos de um dia (padrão: hoje) — "atendimentos do dia". */
agendamentosRoutes.get('/', somente('ADMIN'), async (req, res) => {
  const filtros = z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD').optional(),
    status: z.enum(['AGENDADO', 'CANCELAMENTO_SOLICITADO', 'CANCELADO', 'REALIZADO', 'FALTA']).optional(),
  }).parse(req.query);

  const agendamentos = await query(
    `SELECT ${camposAgendamento}, p.nome_completo, p.telefone, p.situacao,
            q.queixa_principal, to_char(q.inicio_sintomas, 'YYYY-MM-DD') AS queixa_inicio_sintomas,
            q.diagnostico_clinico, q.sem_diagnostico
       FROM agendamentos a
       JOIN horarios h  ON h.id = a.horario_id
       JOIN pacientes p ON p.id = a.paciente_id
       LEFT JOIN queixas_pacientes q ON q.paciente_id = a.paciente_id
      WHERE (h.inicio AT TIME ZONE $1)::date = COALESCE($2::date, (now() AT TIME ZONE $1)::date)
        AND ($3::status_agendamento IS NULL OR a.status = $3)
      ORDER BY h.inicio, p.nome_completo`,
    [config.timezone, filtros.data ?? null, filtros.status ?? null],
  );
  res.json(agendamentos);
});

/** Pedidos de cancelamento esperando decisão da cliente. */
agendamentosRoutes.get('/cancelamentos-pendentes', somente('ADMIN'), async (_req, res) => {
  const pendentes = await query(
    `SELECT ${camposAgendamento}, p.nome_completo
       FROM agendamentos a
       JOIN horarios h  ON h.id = a.horario_id
       JOIN pacientes p ON p.id = a.paciente_id
      WHERE a.status = 'CANCELAMENTO_SOLICITADO'
      ORDER BY a.cancelamento_solicitado_em`,
  );
  res.json(pendentes);
});

/**
 * Cancelamentos e remarcações feitos pelos pacientes (últimos N dias, padrão 30),
 * com a marca de dentro/fora do prazo e, se houve, o novo horário.
 */
agendamentosRoutes.get('/cancelamentos-recentes', somente('ADMIN'), async (req, res) => {
  const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
  const lista = await query(
    `SELECT ${camposAgendamento}, p.nome_completo, p.telefone,
            n.id AS novo_id, nh.inicio AS novo_inicio,
            (n.id IS NOT NULL) AS remarcado
       FROM agendamentos a
       JOIN horarios h  ON h.id = a.horario_id
       JOIN pacientes p ON p.id = a.paciente_id
       LEFT JOIN LATERAL (
         SELECT x.id, x.horario_id FROM agendamentos x
          WHERE (x.remarcado_de = a.id OR x.reposicao_de = a.id) AND x.status <> 'CANCELADO'
          ORDER BY x.criado_em DESC LIMIT 1
       ) n ON TRUE
       LEFT JOIN horarios nh ON nh.id = n.horario_id
      WHERE a.status = 'CANCELADO'
        AND a.cancelado_fora_do_prazo IS NOT NULL
        AND a.cancelamento_solicitado_em >= now() - make_interval(days => $1)
      ORDER BY a.cancelamento_solicitado_em DESC
      LIMIT 200`,
    [dias],
  );
  res.json(lista);
});

/** Cliente agenda por um paciente (as mesmas regras valem; avisa o paciente). */
agendamentosRoutes.post('/pela-clinica', somente('ADMIN'), async (req, res) => {
  const dados = novoAgendamento.extend({ paciente_id: z.string().uuid() }).parse(req.body);

  const agendamento = await transacao(async (c) => {
    const id = await criarAgendamento(c, dados.paciente_id, dados);
    await notificar(c, 'AGENDADO_PELA_CLINICA', id);
    return buscarAgendamento(c, id);
  });
  res.status(201).json(agendamento);
});

/** Cliente aprova ou recusa o pedido de cancelamento; no pilates pode liberar reposição. */
agendamentosRoutes.post('/:id/decidir-cancelamento', somente('ADMIN'), async (req, res) => {
  const { aprovar, liberar_reposicao } = z.object({
    aprovar: z.boolean(),
    liberar_reposicao: z.boolean().default(false),
  }).parse(req.body);

  const agendamento = await transacao(async (c) => {
    await c.query('SELECT fn_decidir_cancelamento($1, $2, $3, $4)', [
      String(req.params.id), aprovar, usuarioDe(req).id, liberar_reposicao,
    ]);
    await notificar(c, aprovar ? 'CANCELAMENTO_APROVADO' : 'CANCELAMENTO_RECUSADO', String(req.params.id));
    return buscarAgendamento(c, String(req.params.id));
  });
  res.json(agendamento);
});

/**
 * Cliente cancela um agendamento por conta própria e avisa o paciente.
 * motivo: texto que vai na notificação. liberar_remarcacao: o paciente remarca sozinho
 * (mesma modalidade). liberar_reposicao continua aceito como sinônimo.
 */
agendamentosRoutes.post('/:id/cancelar', somente('ADMIN'), async (req, res) => {
  const dados = z.object({
    motivo: z.string().trim().max(1000).optional(),
    liberar_remarcacao: z.boolean().optional(),
    liberar_reposicao: z.boolean().optional(),
  }).parse(req.body ?? {});
  const liberar = dados.liberar_remarcacao ?? dados.liberar_reposicao ?? false;
  const id = String(req.params.id);

  const agendamento = await transacao(async (c) => {
    await c.query('SELECT fn_cancelar_pela_clinica($1, $2, $3, $4)', [
      id, usuarioDe(req).id, dados.motivo ?? null, liberar,
    ]);
    await c.query('SELECT fn_notificar_agendamento($1, $2, $3)', ['CANCELADO_PELA_CLINICA', id, dados.motivo ?? null]);
    return buscarAgendamento(c, id);
  });
  res.json(agendamento);
});

/**
 * Cliente cancela todos os atendimentos de um dia ou de horários escolhidos.
 * Cada paciente recebe uma notificação com o motivo escrito pela cliente.
 */
agendamentosRoutes.post('/cancelar-em-lote', somente('ADMIN'), async (req, res) => {
  const dados = z.object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD').optional(),
    horario_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
    motivo: z.string().trim().min(3, 'Escreva o motivo para avisar os pacientes').max(1000),
    liberar_remarcacao: z.boolean().default(true),
    bloquear_horarios: z.boolean().default(true),
  }).refine((d) => Boolean(d.data) !== Boolean(d.horario_ids), {
    message: 'Informe o dia (data) ou os horários (horario_ids), um dos dois',
    path: ['data'],
  }).parse(req.body);

  const resultado = await transacao(async (c) => {
    let horarioIds = dados.horario_ids ?? [];
    if (dados.data) {
      const r = await c.query(
        `SELECT id FROM horarios WHERE (inicio AT TIME ZONE $1)::date = $2::date`,
        [config.timezone, dados.data],
      );
      horarioIds = r.rows.map((h) => h.id as string);
      if (horarioIds.length === 0) throw new ErroHttp(404, 'Não há horários abertos neste dia');
    }

    const cancelados = await c.query(
      `SELECT x.agendamento_id, x.paciente_id, p.nome_completo, h.modalidade, h.inicio
         FROM fn_cancelar_horarios($1::uuid[], $2, $3, $4, $5) x
         JOIN pacientes p ON p.id = x.paciente_id
         JOIN horarios h  ON h.id = x.horario_id
        ORDER BY h.inicio, p.nome_completo`,
      [horarioIds, usuarioDe(req).id, dados.motivo, dados.liberar_remarcacao, dados.bloquear_horarios],
    );

    return {
      horarios_afetados: horarioIds.length,
      horarios_bloqueados: dados.bloquear_horarios,
      remarcacao_liberada: dados.liberar_remarcacao,
      pacientes_avisados: new Set(cancelados.rows.map((a) => a.paciente_id)).size,
      agendamentos_cancelados: cancelados.rows,
    };
  });
  res.json(resultado);
});

/**
 * Cliente troca o paciente de horário (mesma modalidade; avisa o paciente).
 * - horario_id: um horário já aberto
 * - inicio: só fisioterapia; cria o horário novo com a mesma duração da sessão
 */
agendamentosRoutes.post('/:id/remarcar', somente('ADMIN'), async (req, res) => {
  const dados = z.object({ horario_id: z.string().uuid().optional(), inicio: dataHora.optional() })
    .refine((d) => Boolean(d.horario_id) !== Boolean(d.inicio), {
      message: 'Informe o horário (horario_id) ou o novo início (inicio), um dos dois',
      path: ['horario_id'],
    }).parse(req.body);

  const agendamento = await transacao(async (c) => {
    const r = dados.inicio
      ? await c.query('SELECT fn_remarcar_fisioterapia($1, $2, $3) AS id', [String(req.params.id), dados.inicio, usuarioDe(req).id])
      : await c.query('SELECT fn_remarcar_agendamento($1, $2, $3) AS id', [String(req.params.id), dados.horario_id, usuarioDe(req).id]);
    const novoId = r.rows[0].id as string;
    await notificar(c, 'REMARCADO_PELA_CLINICA', novoId);
    return buscarAgendamento(c, novoId);
  });
  res.status(201).json(agendamento);
});

/**
 * Cliente registra que o paciente pagou a aula experimental antes da aula
 * (pelo aplicativo ou via Pix). Paga, ela não pode ser desmarcada pelo
 * paciente e, se ele faltar, conta como dada.
 */
agendamentosRoutes.post('/:id/pagamento', somente('ADMIN'), async (req, res) => {
  const { forma } = z.object({ forma: z.enum(['APLICATIVO', 'PIX']) }).parse(req.body);
  const id = String(req.params.id);

  const agendamento = await transacao(async (c) => {
    await c.query('SELECT fn_registrar_pagamento_experimental($1, $2, $3)', [id, forma, usuarioDe(req).id]);
    return buscarAgendamento(c, id);
  });
  res.json(agendamento);
});

/** Confirma presença ou registra falta (depois do atendimento). */
agendamentosRoutes.post('/:id/presenca', somente('ADMIN'), async (req, res) => {
  const { compareceu } = z.object({ compareceu: z.boolean() }).parse(req.body);

  const atualizado = await queryOne(
    `UPDATE agendamentos
        SET status = $2::status_agendamento, presenca_registrada_em = now()
      WHERE id = $1 AND status IN ('AGENDADO', 'REALIZADO', 'FALTA')
      RETURNING id, status, presenca_registrada_em`,
    [String(req.params.id), compareceu ? 'REALIZADO' : 'FALTA'],
  );
  if (!atualizado) {
    throw new ErroHttp(422, 'Agendamento não encontrado ou cancelado');
  }
  res.json(atualizado);
});

/** Conclui a avaliação: libera ou não libera o paciente (avisa o paciente). */
agendamentosRoutes.post('/:id/avaliacao', somente('ADMIN'), async (req, res) => {
  const { resultado, observacoes, liberar_para } = z.object({
    resultado: z.enum(['LIBERADO', 'NAO_LIBERADO']),
    observacoes: z.string().trim().max(5000).optional(),
    /** Opcional, só para avaliações antigas de AMBAS: liberar só uma modalidade. */
    liberar_para: z.enum(avaliacoesPara).optional(),
  }).parse(req.body);

  const avaliacao = await transacao(async (c) => {
    const r = await c.query('SELECT fn_concluir_avaliacao($1, $2, $3, $4, $5) AS id', [
      String(req.params.id), resultado, observacoes ?? null, usuarioDe(req).id, liberar_para ?? null,
    ]);
    await notificar(c, 'AVALIACAO_CONCLUIDA', String(req.params.id));
    const a = await c.query(
      `SELECT a.*, p.situacao AS situacao_paciente
         FROM avaliacoes a JOIN pacientes p ON p.id = a.paciente_id
        WHERE a.id = $1`,
      [r.rows[0].id],
    );
    return a.rows[0];
  });
  res.status(201).json(avaliacao);
});
