import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, transacao } from '../db';
import { ErroHttp, naoEncontrado } from '../erros';
import { autenticar, somente, usuarioDe } from '../middlewares/auth';

/** Módulo 2 — horários da agenda. */
export const horariosRoutes = Router();
horariosRoutes.use(autenticar);

const modalidades = ['AVALIACAO', 'FISIOTERAPIA', 'PILATES'] as const;
const dataHora = z.string().datetime({ offset: true, message: 'Use data e hora ISO com fuso, ex.: 2026-11-03T14:00:00-03:00' });

/**
 * Horários com vagas restantes.
 * Paciente vê só horários futuros, não bloqueados e com vaga.
 * Cliente vê tudo no período.
 */
horariosRoutes.get('/', async (req, res) => {
  const filtros = z.object({
    de: dataHora.optional(),
    ate: dataHora.optional(),
    modalidade: z.enum(modalidades).optional(),
  }).parse(req.query);

  const admin = usuarioDe(req).papel === 'ADMIN';

  const horarios = await query(
    `SELECT id, modalidade, inicio, fim, capacidade, bloqueado, vagas_restantes
       FROM vw_horarios_vagas
      WHERE inicio >= COALESCE($1::timestamptz, now())
        AND ($2::timestamptz IS NULL OR inicio < $2)
        AND ($3::modalidade IS NULL OR modalidade = $3)
        AND id IN (SELECT id FROM horarios WHERE NOT cancelado)
        AND ($4 OR (NOT bloqueado AND vagas_restantes > 0 AND fn_dentro_do_funcionamento(inicio, fim)))
      ORDER BY inicio`,
    [filtros.de ?? null, filtros.ate ?? null, filtros.modalidade ?? null, admin],
  );
  res.json(horarios);
});

const nomesDias = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** Horário de funcionamento da clínica, por dia da semana (dia sem faixa = fechado). */
horariosRoutes.get('/funcionamento', async (_req, res) => {
  const faixas = await query<{ dia_semana: number; abre: string; fecha: string }>(
    `SELECT dia_semana, to_char(abre, 'HH24:MI') AS abre, to_char(fecha, 'HH24:MI') AS fecha
       FROM funcionamento ORDER BY dia_semana, abre`,
  );
  res.json([1, 2, 3, 4, 5, 6, 7].map((dia) => {
    const doDia = faixas.filter((f) => f.dia_semana === dia).map(({ abre, fecha }) => ({ abre, fecha }));
    return { dia_semana: dia, dia: nomesDias[dia], aberto: doDia.length > 0, faixas: doDia };
  }));
});

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/**
 * Cliente troca o horário de funcionamento (substitui todas as faixas).
 * Horários já abertos fora das novas faixas não recebem agendamentos novos;
 * os que têm agendamento aparecem em GET /horarios/fora-do-funcionamento.
 */
horariosRoutes.put('/funcionamento', somente('ADMIN'), async (req, res) => {
  const faixas = z.array(z.object({
    dia_semana: z.number().int().min(1).max(5, 'A clínica funciona de segunda a sexta'),
    abre: hora,
    fecha: hora,
  }).refine((f) => f.fecha > f.abre, { message: 'O fechamento precisa ser depois da abertura', path: ['fecha'] }))
    .min(1, 'Informe pelo menos uma faixa').max(30).parse(req.body);

  for (const dia of new Set(faixas.map((f) => f.dia_semana))) {
    const doDia = faixas.filter((f) => f.dia_semana === dia).sort((a, b) => a.abre.localeCompare(b.abre));
    for (let i = 1; i < doDia.length; i++) {
      if (doDia[i].abre < doDia[i - 1].fecha) {
        throw new ErroHttp(400, `Faixas sobrepostas na ${nomesDias[dia]}`);
      }
    }
  }

  await transacao(async (c) => {
    await c.query('DELETE FROM funcionamento');
    await c.query(
      `INSERT INTO funcionamento (dia_semana, abre, fecha)
       SELECT * FROM unnest($1::smallint[], $2::time[], $3::time[])`,
      [faixas.map((f) => f.dia_semana), faixas.map((f) => f.abre), faixas.map((f) => f.fecha)],
    );
  });
  res.json({ mensagem: 'Horário de funcionamento atualizado', faixas });
});

/** Horários futuros fora do funcionamento que ainda têm agendamentos (a cliente resolve). */
horariosRoutes.get('/fora-do-funcionamento', somente('ADMIN'), async (_req, res) => {
  res.json(await query('SELECT * FROM vw_horarios_fora_do_funcionamento ORDER BY inicio'));
});

const novoHorario = z.object({
  modalidade: z.enum(modalidades),
  inicio: dataHora,
  fim: dataHora,
});

/** Cliente abre um ou vários horários de uma vez. */
horariosRoutes.post('/', somente('ADMIN'), async (req, res) => {
  const lista = z.union([novoHorario, z.array(novoHorario).min(1).max(200)]).parse(req.body);
  const itens = Array.isArray(lista) ? lista : [lista];

  const criados = await query(
    `INSERT INTO horarios (modalidade, inicio, fim)
     SELECT * FROM unnest($1::modalidade[], $2::timestamptz[], $3::timestamptz[])
     RETURNING id, modalidade, inicio, fim, capacidade, bloqueado`,
    [itens.map((i) => i.modalidade), itens.map((i) => i.inicio), itens.map((i) => i.fim)],
  );
  res.status(201).json(Array.isArray(lista) ? criados : criados[0]);
});

/** Bloquear ou desbloquear um horário. */
horariosRoutes.patch('/:id', somente('ADMIN'), async (req, res) => {
  const { bloqueado, capacidade } = z.object({
    bloqueado: z.boolean().optional(),
    // Só pilates: vagas desta aula neste dia (1 a 8)
    capacidade: z.number().int().min(1, 'Mínimo de 1 vaga').max(8, 'Máximo de 8 alunos por turma').optional(),
  }).refine((d) => d.bloqueado !== undefined || d.capacidade !== undefined, {
    message: 'Informe bloqueado e/ou capacidade',
  }).parse(req.body);

  if (capacidade !== undefined) {
    const h = await queryOne<{ modalidade: string }>('SELECT modalidade FROM horarios WHERE id = $1', [req.params.id]);
    if (!h) throw naoEncontrado('Horário');
    if (h.modalidade !== 'PILATES') throw new ErroHttp(400, 'Só a aula de pilates tem capacidade ajustável');
  }

  const horario = await queryOne(
    `UPDATE horarios SET bloqueado = COALESCE($2, bloqueado), capacidade = COALESCE($3, capacidade)
      WHERE id = $1
     RETURNING id, modalidade, inicio, fim, capacidade, bloqueado`,
    [req.params.id, bloqueado ?? null, capacidade ?? null],
  );
  if (!horario) throw naoEncontrado('Horário');
  res.json(horario);
});
