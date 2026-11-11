import { Router } from 'express';
import { query } from '../db';
import { autenticar, somente } from '../middlewares/auth';

export const alertasRoutes = Router();
alertasRoutes.use(autenticar, somente('ADMIN'));

/** Pacientes com 2 ou mais faltas em aulas experimentais, com a observação para a cliente. */
alertasRoutes.get('/faltas-experimental', async (_req, res) => {
  const alertas = await query(
    `SELECT paciente_id, nome_completo, faltas_experimentais, ultima_falta, observacao
       FROM vw_alerta_faltas_experimental
      ORDER BY ultima_falta DESC`,
  );
  res.json(alertas);
});
