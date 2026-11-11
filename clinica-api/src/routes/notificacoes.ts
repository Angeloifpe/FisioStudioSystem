import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { naoEncontrado } from '../erros';
import { autenticar, usuarioDe } from '../middlewares/auth';

/**
 * Notificações dentro do app.
 * A cliente vê as ações dos pacientes; cada paciente vê as respostas da clínica.
 * O app consulta periodicamente (ex.: a cada 30 s) ou ao abrir a tela.
 */
export const notificacoesRoutes = Router();
notificacoesRoutes.use(autenticar);

/** Filtro de "minhas notificações" conforme o papel de quem está logado. */
function filtroDestinatario(req: Parameters<typeof usuarioDe>[0]) {
  const u = usuarioDe(req);
  return u.papel === 'ADMIN'
    ? { sql: `n.destinatario = 'ADMIN'`, params: [] as unknown[] }
    : { sql: `n.destinatario = 'PACIENTE' AND n.paciente_id = $1`, params: [u.pacienteId] as unknown[] };
}

/** Lista as notificações (mais novas primeiro). ?nao_lidas=true para só as não lidas. */
notificacoesRoutes.get('/', async (req, res) => {
  const { nao_lidas, limite } = z.object({
    nao_lidas: z.enum(['true', 'false']).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);

  const f = filtroDestinatario(req);
  const n = f.params.length;
  const notificacoes = await query(
    `SELECT n.id, n.tipo, n.mensagem, n.paciente_id, p.nome_completo, n.agendamento_id,
            n.lida_em, n.criada_em
       FROM notificacoes n
       JOIN pacientes p ON p.id = n.paciente_id
      WHERE ${f.sql}
        AND ($${n + 1}::boolean IS NOT TRUE OR n.lida_em IS NULL)
      ORDER BY n.criada_em DESC
      LIMIT $${n + 2}`,
    [...f.params, nao_lidas === 'true', limite],
  );
  res.json(notificacoes);
});

/** Quantidade de não lidas (para o "sininho" do app). */
notificacoesRoutes.get('/contagem', async (req, res) => {
  const f = filtroDestinatario(req);
  const linha = await queryOne(
    `SELECT COUNT(*) AS nao_lidas FROM notificacoes n WHERE ${f.sql} AND n.lida_em IS NULL`,
    f.params,
  );
  res.json(linha);
});

/** Marca uma notificação como lida. */
notificacoesRoutes.post('/:id/lida', async (req, res) => {
  const f = filtroDestinatario(req);
  const n = f.params.length;
  const linha = await queryOne(
    `UPDATE notificacoes n SET lida_em = COALESCE(n.lida_em, now())
      WHERE ${f.sql} AND n.id = $${n + 1}
      RETURNING n.id, n.lida_em`,
    [...f.params, req.params.id],
  );
  if (!linha) throw naoEncontrado('Notificação');
  res.json(linha);
});

/** Marca todas como lidas. */
notificacoesRoutes.post('/ler-todas', async (req, res) => {
  const f = filtroDestinatario(req);
  const linhas = await query(
    `UPDATE notificacoes n SET lida_em = now()
      WHERE ${f.sql} AND n.lida_em IS NULL
      RETURNING n.id`,
    f.params,
  );
  res.json({ marcadas: linhas.length });
});
