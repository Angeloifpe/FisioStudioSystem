import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { naoEncontrado } from '../erros';
import { autenticar, somente, usuarioDe } from '../middlewares/auth';

/** Módulo 3 — registro básico de atendimentos (só a cliente). */
export const registrosRoutes = Router();
registrosRoutes.use(autenticar, somente('ADMIN'));

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');

/**
 * Registra um atendimento.
 * agendamento_id é opcional (ex.: fisioterapia atendida fora do horário marcado).
 */
registrosRoutes.post('/', async (req, res) => {
  const dados = z.object({
    paciente_id: z.string().uuid(),
    data_atendimento: data,
    observacoes: z.string().trim().max(10000).optional(),
    agendamento_id: z.string().uuid().optional(),
  }).parse(req.body);

  const registro = await queryOne(
    `INSERT INTO registros_atendimento (paciente_id, agendamento_id, data_atendimento, observacoes, criado_por)
     SELECT $1, $2, $3, $4, $5
      WHERE $2::uuid IS NULL
         OR EXISTS (SELECT 1 FROM agendamentos WHERE id = $2 AND paciente_id = $1)
     RETURNING *`,
    [dados.paciente_id, dados.agendamento_id ?? null, dados.data_atendimento, dados.observacoes ?? null, usuarioDe(req).id],
  );
  if (!registro) throw naoEncontrado('Agendamento deste paciente');
  res.status(201).json(registro);
});

/** Registros anteriores de um paciente. */
registrosRoutes.get('/', async (req, res) => {
  const { paciente_id } = z.object({ paciente_id: z.string().uuid() }).parse(req.query);
  const registros = await query(
    `SELECT * FROM registros_atendimento
      WHERE paciente_id = $1
      ORDER BY data_atendimento DESC, criado_em DESC`,
    [paciente_id],
  );
  res.json(registros);
});

/** Edita data ou observações de um registro. */
registrosRoutes.patch('/:id', async (req, res) => {
  const dados = z.object({
    data_atendimento: data.optional(),
    observacoes: z.string().trim().max(10000).nullable().optional(),
  }).strict().parse(req.body);

  const registro = await queryOne(
    `UPDATE registros_atendimento
        SET data_atendimento = COALESCE($2, data_atendimento),
            observacoes = CASE WHEN $3 THEN $4 ELSE observacoes END
      WHERE id = $1
      RETURNING *`,
    [req.params.id, dados.data_atendimento ?? null, dados.observacoes !== undefined, dados.observacoes ?? null],
  );
  if (!registro) throw naoEncontrado('Registro');
  res.json(registro);
});
