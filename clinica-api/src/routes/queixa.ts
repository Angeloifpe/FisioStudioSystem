import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../db';
import { ErroHttp } from '../erros';
import { autenticar, somente, usuarioDe } from '../middlewares/auth';

/**
 * "Sobre sua queixa": o paciente conta o que está sentindo antes da avaliação inicial
 * e a clínica lê. Um registro por paciente (o paciente pode atualizar).
 */
export const queixaRoutes = Router();
queixaRoutes.use(autenticar);

const campos = `paciente_id, queixa_principal, to_char(inicio_sintomas, 'YYYY-MM-DD') AS inicio_sintomas,
  diagnostico_clinico, sem_diagnostico, criado_em, atualizado_em`;

const queixaSchema = z.object({
  queixa_principal: z.string().trim().min(5, 'Conte um pouco mais sobre a queixa (mínimo de 5 letras)').max(500, 'No máximo 500 caracteres'),
  inicio_sintomas: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD'),
  diagnostico_clinico: z.string().trim().max(500, 'No máximo 500 caracteres').nullable().optional(),
  sem_diagnostico: z.boolean().optional(),
}).strict();

/** A queixa de quem está logado (ou null, se ainda não preencheu). */
queixaRoutes.get('/minha', somente('PACIENTE'), async (req, res) => {
  const u = usuarioDe(req);
  const linha = await queryOne(`SELECT ${campos} FROM queixas_pacientes WHERE paciente_id = $1`, [u.pacienteId]);
  res.json(linha ?? null);
});

/** Cria ou atualiza a própria queixa. */
queixaRoutes.put('/minha', somente('PACIENTE'), async (req, res) => {
  const u = usuarioDe(req);
  if (!u.pacienteId) throw new ErroHttp(403, 'Apenas pacientes preenchem a queixa');
  const d = queixaSchema.parse(req.body);
  const linha = await queryOne(
    `SELECT paciente_id, queixa_principal, to_char(inicio_sintomas, 'YYYY-MM-DD') AS inicio_sintomas,
            diagnostico_clinico, sem_diagnostico, criado_em, atualizado_em
       FROM fn_salvar_queixa($1, $2, $3::date, $4, $5)`,
    [u.pacienteId, d.queixa_principal, d.inicio_sintomas, d.diagnostico_clinico ?? null, d.sem_diagnostico ?? false],
  );
  res.json(linha);
});

/** A clínica lê a queixa de um paciente (ou null). */
queixaRoutes.get('/paciente/:id', somente('ADMIN'), async (req, res) => {
  const linha = await queryOne(`SELECT ${campos} FROM queixas_pacientes WHERE paciente_id = $1`, [req.params.id]);
  res.json(linha ?? null);
});
