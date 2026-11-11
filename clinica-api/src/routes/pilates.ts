import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, transacao } from '../db';
import { ErroHttp, naoEncontrado } from '../erros';
import { autenticar, somente, usuarioDe } from '../middlewares/auth';

/**
 * Pilates: turmas que podem ser fixadas e horários fixos dos alunos.
 * Regras (no banco): até 2 aulas regulares por semana, em dias diferentes;
 * até 2 horários fixos por aluno, de segunda a sexta.
 */
export const pilatesRoutes = Router();
pilatesRoutes.use(autenticar);

const camposFixo = `
  f.id, f.paciente_id, f.dia_semana, to_char(f.hora, 'HH24:MI') AS hora, f.ativo, f.criado_em, f.encerrado_em,
  (SELECT COUNT(*) FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
    WHERE a.fixo_id = f.id AND a.status <> 'CANCELADO' AND h.inicio > now()) AS aulas_reservadas`;

/** Turmas de pilates (dia da semana + hora) com aulas futuras abertas. */
pilatesRoutes.get('/turmas', async (_req, res) => {
  const turmas = await query(
    `SELECT t.dia_semana, to_char(t.hora, 'HH24:MI') AS hora, t.aulas_abertas, t.menor_vaga, t.proxima_aula,
            (SELECT COUNT(*) FROM pilates_fixos f WHERE f.ativo AND f.dia_semana = t.dia_semana AND f.hora = t.hora) AS alunos_fixos
       FROM vw_turmas_pilates t
      ORDER BY t.dia_semana, t.hora`,
  );
  res.json(turmas);
});

/** Horários fixos ativos: do próprio aluno, ou de um paciente (?paciente_id) / de todos para a cliente. */
pilatesRoutes.get('/fixos', async (req, res) => {
  const u = usuarioDe(req);
  const { paciente_id } = z.object({ paciente_id: z.string().uuid().optional() }).parse(req.query);
  const alvo = u.papel === 'ADMIN' ? paciente_id ?? null : u.pacienteId;

  const fixos = await query(
    `SELECT ${camposFixo}, p.nome_completo
       FROM pilates_fixos f JOIN pacientes p ON p.id = f.paciente_id
      WHERE f.ativo AND ($1::uuid IS NULL OR f.paciente_id = $1)
      ORDER BY p.nome_completo, f.dia_semana`,
    [alvo],
  );
  res.json(fixos);
});

/**
 * Fixa uma turma (dia_semana 1 = segunda ... 5 = sexta; hora "HH:MM").
 * O aluno fixa para si; a cliente informa paciente_id. Avisa o outro lado.
 */
pilatesRoutes.post('/fixos', async (req, res) => {
  const u = usuarioDe(req);
  const dados = z.object({
    dia_semana: z.coerce.number().int().min(1).max(5, 'A clínica funciona de segunda a sexta'),
    hora: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
    paciente_id: z.string().uuid().optional(),
  }).parse(req.body);

  const pacienteId = u.papel === 'ADMIN' ? dados.paciente_id : u.pacienteId;
  if (!pacienteId) throw new ErroHttp(400, 'Informe o paciente');

  const fixo = await transacao(async (c) => {
    const r = await c.query('SELECT fn_fixar_pilates($1, $2::smallint, $3::time) AS id', [pacienteId, dados.dia_semana, dados.hora]);
    const f = await c.query(`SELECT ${camposFixo} FROM pilates_fixos f WHERE f.id = $1`, [r.rows[0].id]);
    await c.query('SELECT fn_notificar_fixo($1, $2, $3)', [
      r.rows[0].id, u.papel === 'ADMIN' ? 'PACIENTE' : 'ADMIN', f.rows[0].aulas_reservadas,
    ]);
    return f.rows[0];
  });
  res.status(201).json(fixo);
});

/** Desfaz o horário fixo e cancela as aulas futuras reservadas por ele. Avisa o outro lado. */
pilatesRoutes.delete('/fixos/:id', async (req, res) => {
  const u = usuarioDe(req);
  const id = String(req.params.id);
  const fixo = await queryOne('SELECT paciente_id FROM pilates_fixos WHERE id = $1 AND ativo', [id]);
  if (!fixo || (u.papel !== 'ADMIN' && fixo.paciente_id !== u.pacienteId)) throw naoEncontrado('Horário fixo');

  const canceladas = await transacao(async (c) => {
    const r = await c.query('SELECT fn_desfazer_fixo($1) AS n', [id]);
    await c.query('SELECT fn_notificar_fixo($1, $2, $3)', [id, u.papel === 'ADMIN' ? 'PACIENTE' : 'ADMIN', r.rows[0].n]);
    return r.rows[0].n as number;
  });
  res.json({ id, aulas_canceladas: canceladas });
});

const nomesDias = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Grade semanal das aulas de pilates (nesses horários não se marca fisioterapia). */
pilatesRoutes.get('/grade', async (_req, res) => {
  const aulas = await query<{ dia_semana: number; inicio: string; fim: string; capacidade: number }>(
    `SELECT dia_semana, to_char(inicio, 'HH24:MI') AS inicio, to_char(fim, 'HH24:MI') AS fim, capacidade
       FROM pilates_grade ORDER BY dia_semana, inicio`,
  );
  res.json([1, 2, 3, 4, 5].map((dia) => ({
    dia_semana: dia,
    dia: nomesDias[dia],
    aulas: aulas.filter((a) => a.dia_semana === dia).map(({ inicio, fim, capacidade }) => ({ inicio, fim, capacidade })),
  })));
});

/**
 * Cliente muda quantos alunos cabem numa aula da grade (1 a 8). Por padrão vale
 * também para as aulas futuras já abertas daquele horário; as que já têm mais
 * alunos que a nova capacidade ficam como estão e voltam na resposta.
 */
pilatesRoutes.patch('/grade/capacidade', somente('ADMIN'), async (req, res) => {
  const dados = z.object({
    dia_semana: z.number().int().min(1).max(5),
    inicio: hora,
    capacidade: z.number().int().min(1, 'Mínimo de 1 vaga').max(8, 'Máximo de 8 alunos por turma'),
    aplicar_nas_aulas_abertas: z.boolean().default(true),
  }).parse(req.body);

  const naoAlteradas = await query(
    'SELECT horario_id, inicio, agendados FROM fn_definir_capacidade_turma($1::smallint, $2::time, $3::smallint, $4)',
    [dados.dia_semana, dados.inicio, dados.capacidade, dados.aplicar_nas_aulas_abertas],
  );
  res.json({ ...dados, aulas_nao_alteradas: naoAlteradas });
});

/** Configurações do pilates: capacidade padrão e antecedência mínima do aviso de falta. */
pilatesRoutes.get('/config', async (_req, res) => {
  res.json(await queryOne('SELECT capacidade_padrao_pilates, antecedencia_aviso_falta_min FROM config_clinica'));
});

pilatesRoutes.put('/config', somente('ADMIN'), async (req, res) => {
  const dados = z.object({
    capacidade_padrao_pilates: z.number().int().min(1).max(8).optional(),
    antecedencia_aviso_falta_min: z.number().int().min(0).max(1440).optional(),
  }).parse(req.body);
  const config = await queryOne(
    `UPDATE config_clinica
        SET capacidade_padrao_pilates = COALESCE($1, capacidade_padrao_pilates),
            antecedencia_aviso_falta_min = COALESCE($2, antecedencia_aviso_falta_min)
     RETURNING capacidade_padrao_pilates, antecedencia_aviso_falta_min`,
    [dados.capacidade_padrao_pilates ?? null, dados.antecedencia_aviso_falta_min ?? null],
  );
  res.json(config);
});

/**
 * Cliente troca a grade (substitui todas as aulas). Vale para os horários
 * abertos daqui em diante; os já abertos continuam. capacidade é opcional
 * (padrão: a capacidade padrão da clínica, 8).
 */
pilatesRoutes.put('/grade', somente('ADMIN'), async (req, res) => {
  const aulas = z.array(z.object({
    dia_semana: z.number().int().min(1).max(5, 'A clínica funciona de segunda a sexta'),
    inicio: hora,
    fim: hora,
    capacidade: z.number().int().min(1).max(8, 'Máximo de 8 alunos por turma').optional(),
  }).refine((a) => a.fim > a.inicio, { message: 'O fim precisa ser depois do início', path: ['fim'] }))
    .min(1, 'Informe pelo menos uma aula').max(60).parse(req.body);

  for (const dia of new Set(aulas.map((a) => a.dia_semana))) {
    const doDia = aulas.filter((a) => a.dia_semana === dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < doDia.length; i++) {
      if (doDia[i].inicio < doDia[i - 1].fim) throw new ErroHttp(400, `Aulas sobrepostas na ${nomesDias[dia]}`);
    }
  }

  await transacao(async (c) => {
    await c.query('DELETE FROM pilates_grade');
    // Sem capacidade informada: a padrão da clínica
    await c.query(
      `INSERT INTO pilates_grade (dia_semana, inicio, fim, capacidade)
       SELECT g.dia, g.inicio, g.fim, COALESCE(g.capacidade, (SELECT capacidade_padrao_pilates FROM config_clinica))
         FROM unnest($1::smallint[], $2::time[], $3::time[], $4::smallint[]) AS g(dia, inicio, fim, capacidade)`,
      [aulas.map((a) => a.dia_semana), aulas.map((a) => a.inicio), aulas.map((a) => a.fim),
        aulas.map((a) => a.capacidade ?? null)],
    );
  });
  res.json({ mensagem: 'Grade de pilates atualizada', aulas });
});

/** Cliente abre de uma vez todas as aulas da grade num período (pula feriados e o que já existe). */
pilatesRoutes.post('/grade/abrir', somente('ADMIN'), async (req, res) => {
  const { de, ate } = z.object({
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD'),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD'),
  }).parse(req.body);
  const r = await queryOne<{ n: number }>('SELECT fn_abrir_aulas_pilates($1::date, $2::date) AS n', [de, ate]);
  res.status(201).json({ aulas_abertas: r?.n ?? 0, de, ate });
});

/** Só a cliente: lista quem é fixo em cada turma. */
pilatesRoutes.get('/turmas/alunos-fixos', somente('ADMIN'), async (_req, res) => {
  const lista = await query(
    `SELECT f.dia_semana, to_char(f.hora, 'HH24:MI') AS hora, p.id AS paciente_id, p.nome_completo
       FROM pilates_fixos f JOIN pacientes p ON p.id = f.paciente_id
      WHERE f.ativo
      ORDER BY f.dia_semana, f.hora, p.nome_completo`,
  );
  res.json(lista);
});
