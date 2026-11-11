import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { query, queryOne, transacao } from '../db';
import { naoEncontrado } from '../erros';
import { autenticar, somente, usuarioDe } from '../middlewares/auth';

/** Módulo 1 — gestão de pacientes (só a cliente). */
export const pacientesRoutes = Router();
pacientesRoutes.use(autenticar, somente('ADMIN'));

const situacoes = ['AGUARDANDO_AVALIACAO', 'LIBERADO', 'NAO_LIBERADO', 'ALTA', 'INTERROMPIDO'] as const;

/** Lista de pacientes, com filtro por situação e busca por nome ou CPF. */
pacientesRoutes.get('/', async (req, res) => {
  const filtros = z.object({
    situacao: z.enum(situacoes).optional(),
    busca: z.string().trim().optional(),
  }).parse(req.query);

  const pacientes = await query(
    `SELECT p.id, p.nome_completo, p.cpf, p.telefone, p.situacao, p.liberado_pilates, p.liberado_fisioterapia,
            p.nova_avaliacao_bloqueada, p.nova_avaliacao_pedida_em,
            p.duracao_fisioterapia_min, u.email, p.criado_em
       FROM pacientes p
       JOIN usuarios u ON u.id = p.usuario_id
      WHERE ($1::situacao_paciente IS NULL OR p.situacao = $1)
        AND ($2::text IS NULL OR p.nome_completo ILIKE '%' || $2 || '%' OR p.cpf LIKE $2 || '%')
      ORDER BY p.nome_completo`,
    [filtros.situacao ?? null, filtros.busca || null],
  );
  res.json(pacientes);
});

/** Dados cadastrais + avaliações + mudanças de situação. */
pacientesRoutes.get('/:id', async (req, res) => {
  const paciente = await queryOne(
    `SELECT p.*, u.email
       FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.id = $1`,
    [req.params.id],
  );
  if (!paciente) throw naoEncontrado('Paciente');

  const [avaliacoes, mudancas] = await Promise.all([
    query(
      `SELECT a.id, a.resultado, a.avaliacao_para, a.liberado_para, a.observacoes, a.avaliado_em, h.inicio AS data_avaliacao
         FROM avaliacoes a
         JOIN agendamentos ag ON ag.id = a.agendamento_id
         JOIN horarios h ON h.id = ag.horario_id
        WHERE a.paciente_id = $1
        ORDER BY a.avaliado_em DESC`,
      [req.params.id],
    ),
    query(
      `SELECT situacao_anterior, situacao_nova, motivo, alterado_em
         FROM mudancas_situacao
        WHERE paciente_id = $1
        ORDER BY alterado_em DESC`,
      [req.params.id],
    ),
  ]);

  res.json({ ...paciente, avaliacoes, mudancas_situacao: mudancas });
});

const edicaoSchema = z.object({
  nome_completo: z.string().trim().min(3).max(150).optional(),
  cpf: z.string().transform((v) => v.replace(/\D/g, '')).pipe(z.string().length(11)).optional(),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  telefone: z.string().trim().min(8).max(20).optional(),
  endereco: z.string().trim().max(255).nullable().optional(),
  /** Quanto dura a sessão de fisioterapia deste paciente (30 a 60 min, de 5 em 5). */
  duracao_fisioterapia_min: z.number().int().min(30, 'Mínimo de 30 minutos').max(60, 'Máximo de 60 minutos')
    .multipleOf(5, 'Use múltiplos de 5 minutos').optional(),
}).strict();

/** Edita dados cadastrais (a situação muda só pelas rotas próprias). */
pacientesRoutes.patch('/:id', async (req, res) => {
  const dados = edicaoSchema.parse(req.body);
  const campos = Object.entries(dados).filter(([, v]) => v !== undefined);
  if (campos.length === 0) {
    const atual = await queryOne('SELECT * FROM pacientes WHERE id = $1', [req.params.id]);
    if (!atual) throw naoEncontrado('Paciente');
    res.json(atual);
    return;
  }

  const sets = campos.map(([campo], i) => `${campo} = $${i + 2}`).join(', ');
  const atualizado = await queryOne(
    `UPDATE pacientes SET ${sets} WHERE id = $1 RETURNING *`,
    [req.params.id, ...campos.map(([, v]) => v)],
  );
  if (!atualizado) throw naoEncontrado('Paciente');
  res.json(atualizado);
});

/** Reabrir (nova avaliação), dar alta ou interromper o tratamento. */
pacientesRoutes.post('/:id/situacao', async (req, res) => {
  const { situacao, motivo } = z.object({
    situacao: z.enum(['AGUARDANDO_AVALIACAO', 'ALTA', 'INTERROMPIDO']),
    motivo: z.string().trim().max(1000).optional(),
  }).parse(req.body);

  const paciente = await transacao(async (c) => {
    await c.query('SELECT fn_mudar_situacao_paciente($1, $2, $3, $4)', [
      req.params.id, situacao, motivo ?? null, usuarioDe(req).id,
    ]);
    // Avisa o paciente (reabertura, alta ou interrupção)
    await c.query(`SELECT fn_notificar_paciente('SITUACAO_ALTERADA', $1)`, [req.params.id]);
    const r = await c.query('SELECT id, nome_completo, situacao FROM pacientes WHERE id = $1', [req.params.id]);
    return r.rows[0];
  });
  res.json(paciente);
});

/**
 * Libera uma nova avaliação para quem não foi liberado numa avaliação
 * (sem liberação nenhuma, volta a aguardar avaliação). Avisa o paciente.
 */
pacientesRoutes.post('/:id/liberar-nova-avaliacao', async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
  const paciente = await transacao(async (c) => {
    await c.query('SELECT fn_liberar_nova_avaliacao($1, $2, $3)', [req.params.id, usuarioDe(req).id, motivo ?? null]);
    const r = await c.query('SELECT id, nome_completo, situacao, nova_avaliacao_bloqueada FROM pacientes WHERE id = $1', [req.params.id]);
    return r.rows[0];
  });
  res.json(paciente);
});

/** Letras e números fáceis de ditar (sem 0/O, 1/l/I). */
const alfabetoSenha = 'abcdefghjkmnpqrstuvwxyz23456789';

function gerarSenhaTemporaria(tamanho = 8): string {
  return Array.from({ length: tamanho }, () => alfabetoSenha[randomInt(alfabetoSenha.length)]).join('');
}

/**
 * Cria uma senha temporária para o paciente (ex.: esqueceu a senha).
 * A senha aparece só nesta resposta; a cliente repassa ao paciente, que
 * precisa trocá-la no primeiro login, dentro do prazo.
 */
pacientesRoutes.post('/:id/senha-temporaria', async (req, res) => {
  const { senha, validade_horas } = z.object({
    senha: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres').max(72).optional(),
    validade_horas: z.number().int().min(1).max(24 * 30).default(72),
  }).parse(req.body ?? {});

  const senhaTemporaria = senha ?? gerarSenhaTemporaria();
  const atualizado = await queryOne(
    `UPDATE usuarios u
        SET senha_hash = $2,
            senha_temporaria_expira_em = now() + make_interval(hours => $3)
       FROM pacientes p
      WHERE p.id = $1 AND p.usuario_id = u.id
      RETURNING u.email, u.senha_temporaria_expira_em AS expira_em`,
    [req.params.id, await bcrypt.hash(senhaTemporaria, 10), validade_horas],
  );
  if (!atualizado) throw naoEncontrado('Paciente');

  res.json({ email: atualizado.email, senha_temporaria: senhaTemporaria, expira_em: atualizado.expira_em });
});

/** Histórico básico: agendamentos (com presença/falta) e registros de atendimento. */
pacientesRoutes.get('/:id/historico', async (req, res) => {
  const existe = await queryOne('SELECT 1 FROM pacientes WHERE id = $1', [req.params.id]);
  if (!existe) throw naoEncontrado('Paciente');

  const [agendamentos, registros] = await Promise.all([
    query(
      `SELECT a.id, h.modalidade, h.inicio, h.fim, a.status, a.experimental,
              a.reposicao_de, a.reposicao_liberada, a.motivo_cancelamento
         FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
        WHERE a.paciente_id = $1
        ORDER BY h.inicio DESC`,
      [req.params.id],
    ),
    query(
      `SELECT id, agendamento_id, data_atendimento, observacoes, criado_em, atualizado_em
         FROM registros_atendimento
        WHERE paciente_id = $1
        ORDER BY data_atendimento DESC, criado_em DESC`,
      [req.params.id],
    ),
  ]);

  res.json({ agendamentos, registros });
});
