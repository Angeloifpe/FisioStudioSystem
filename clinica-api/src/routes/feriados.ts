import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { naoEncontrado } from '../erros';
import { autenticar, somente, usuarioDe } from '../middlewares/auth';

/**
 * Feriados: a clínica não abre, então não há atendimento.
 * Já vêm cadastrados os nacionais e o estadual de Pernambuco (6 de março) de 2026 a 2035.
 * A cliente acrescenta São João, Carnaval e feriados da cidade.
 */
export const feriadosRoutes = Router();
feriadosRoutes.use(autenticar);

const tipos = ['NACIONAL', 'ESTADUAL', 'MUNICIPAL', 'FACULTATIVO', 'OUTRO'] as const;
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');

/** Feriados de um período (padrão: de hoje até um ano à frente). */
feriadosRoutes.get('/', async (req, res) => {
  const { de, ate } = z.object({ de: data.optional(), ate: data.optional() }).parse(req.query);
  const lista = await query(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data, nome, tipo
       FROM feriados
      WHERE data >= COALESCE($1::date, current_date)
        AND data <= COALESCE($2::date, current_date + 366)
      ORDER BY data`,
    [de ?? null, ate ?? null],
  );
  res.json(lista);
});

/** Cliente cadastra um feriado; os atendimentos do dia são cancelados e os pacientes avisados (sem remarcação). */
feriadosRoutes.post('/', somente('ADMIN'), async (req, res) => {
  const dados = z.object({
    data,
    nome: z.string().trim().min(2, 'Informe o nome do feriado').max(120),
    tipo: z.enum(tipos).default('MUNICIPAL'),
  }).parse(req.body);

  const existe = await queryOne('SELECT nome FROM feriados WHERE data = $1', [dados.data]);
  if (existe) {
    res.status(409).json({ erro: `Este dia já é feriado: ${existe.nome}` });
    return;
  }

  const r = await pool.query('SELECT fn_adicionar_feriado($1, $2, $3, $4) AS cancelados', [
    dados.data, dados.nome, dados.tipo, usuarioDe(req).id,
  ]);
  res.status(201).json({ ...dados, atendimentos_cancelados: r.rows[0].cancelados });
});

/** Remove um feriado (a cliente pode abrir horários nesse dia de novo). */
feriadosRoutes.delete('/:data', somente('ADMIN'), async (req, res) => {
  const d = data.parse(req.params.data);
  const r = await queryOne('DELETE FROM feriados WHERE data = $1 RETURNING nome', [d]);
  if (!r) throw naoEncontrado('Feriado');
  res.json({ data: d, nome: r.nome, removido: true });
});
