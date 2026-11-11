import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { queryOne, transacao } from '../db';
import { ErroHttp } from '../erros';
import { autenticar, gerarToken, pacienteDe, somente, usuarioDe } from '../middlewares/auth';

export const authRoutes = Router();

const cadastroSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres'),
  nome_completo: z.string().trim().min(3, 'Informe o nome completo').max(150),
  cpf: z.string().transform((v) => v.replace(/\D/g, '')).pipe(z.string().length(11, 'CPF deve ter 11 dígitos')),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD'),
  telefone: z.string().trim().min(8).max(20),
  endereco: z.string().trim().max(255).optional(),
});

/** Pré-cadastro do paciente: entra como AGUARDANDO_AVALIACAO, sem aprovação. */
authRoutes.post('/cadastro', async (req, res) => {
  const dados = cadastroSchema.parse(req.body);
  const senhaHash = await bcrypt.hash(dados.senha, 10);

  const { usuarioId, pacienteId } = await transacao(async (c) => {
    const u = await c.query(
      `INSERT INTO usuarios (email, senha_hash, papel) VALUES ($1, $2, 'PACIENTE') RETURNING id`,
      [dados.email, senhaHash],
    );
    const p = await c.query(
      `INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone, endereco)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [u.rows[0].id, dados.nome_completo, dados.cpf, dados.data_nascimento, dados.telefone, dados.endereco ?? null],
    );
    // Avisa a cliente que chegou um paciente novo
    await c.query(`SELECT fn_notificar_paciente('CADASTRO_NOVO', $1)`, [p.rows[0].id]);
    return { usuarioId: u.rows[0].id as string, pacienteId: p.rows[0].id as string };
  });

  const token = gerarToken({ id: usuarioId, papel: 'PACIENTE', pacienteId });
  res.status(201).json({ token, papel: 'PACIENTE', paciente_id: pacienteId, situacao: 'AGUARDANDO_AVALIACAO' });
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  senha: z.string().min(1),
});

authRoutes.post('/login', async (req, res) => {
  const { email, senha } = loginSchema.parse(req.body);

  const usuario = await queryOne(
    `SELECT u.id, u.senha_hash, u.papel, u.ativo, u.senha_temporaria_expira_em,
            p.id AS paciente_id, p.situacao
       FROM usuarios u
       LEFT JOIN pacientes p ON p.usuario_id = u.id
      WHERE u.email = $1`,
    [email],
  );

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
    throw new ErroHttp(401, 'E-mail ou senha incorretos');
  }
  if (!usuario.ativo) {
    throw new ErroHttp(403, 'Conta desativada; procure a clínica');
  }

  const expiraEm: Date | null = usuario.senha_temporaria_expira_em;
  if (expiraEm && expiraEm.getTime() < Date.now()) {
    throw new ErroHttp(401, 'Sua senha temporária expirou; peça uma nova à clínica');
  }
  const trocarSenha = expiraEm !== null;

  const token = gerarToken({ id: usuario.id, papel: usuario.papel, pacienteId: usuario.paciente_id, trocarSenha });
  res.json({
    token,
    papel: usuario.papel,
    paciente_id: usuario.paciente_id,
    situacao: usuario.situacao,
    trocar_senha: trocarSenha,
  });
});

const trocaSenhaSchema = z.object({
  senha_atual: z.string().min(1, 'Informe a senha atual'),
  nova_senha: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres').max(72),
});

/** Troca a própria senha (paciente ou cliente). Também encerra a senha temporária. */
authRoutes.post('/trocar-senha', autenticar, async (req, res) => {
  const u = usuarioDe(req);
  const { senha_atual, nova_senha } = trocaSenhaSchema.parse(req.body);

  const usuario = await queryOne(
    `SELECT u.senha_hash, u.papel, p.id AS paciente_id
       FROM usuarios u LEFT JOIN pacientes p ON p.usuario_id = u.id
      WHERE u.id = $1 AND u.ativo`,
    [u.id],
  );
  if (!usuario) throw new ErroHttp(401, 'Faça login para continuar');

  if (!(await bcrypt.compare(senha_atual, usuario.senha_hash))) {
    throw new ErroHttp(400, 'Senha atual incorreta');
  }
  if (senha_atual === nova_senha) {
    throw new ErroHttp(400, 'A nova senha precisa ser diferente da atual');
  }

  await queryOne(
    `UPDATE usuarios SET senha_hash = $2, senha_temporaria_expira_em = NULL WHERE id = $1`,
    [u.id, await bcrypt.hash(nova_senha, 10)],
  );

  // Novo token, já sem a marca de senha temporária
  const token = gerarToken({ id: u.id, papel: usuario.papel, pacienteId: usuario.paciente_id });
  res.json({ mensagem: 'Senha alterada', token });
});

/** Dados de quem está logado (para o app saber o que mostrar). */
authRoutes.get('/me', autenticar, async (req, res) => {
  const u = usuarioDe(req);
  const dados = await queryOne(
    `SELECT u.id, u.email, u.papel,
            (u.senha_temporaria_expira_em IS NOT NULL) AS trocar_senha,
            p.id AS paciente_id, p.nome_completo, p.cpf, p.data_nascimento,
            p.telefone, p.endereco, p.situacao, p.duracao_fisioterapia_min,
            p.liberado_pilates, p.liberado_fisioterapia,
            p.nova_avaliacao_bloqueada, p.nova_avaliacao_pedida_em
       FROM usuarios u
       LEFT JOIN pacientes p ON p.usuario_id = u.id
      WHERE u.id = $1`,
    [u.id],
  );
  res.json(dados);
});

/**
 * Paciente não liberado numa avaliação pede à clínica uma nova avaliação
 * (só a clínica libera; avisa a cliente).
 */
authRoutes.post('/pedir-nova-avaliacao', autenticar, somente('PACIENTE'), async (req, res) => {
  await queryOne('SELECT fn_pedir_nova_avaliacao($1)', [pacienteDe(req)]);
  res.json({ pedido_enviado: true });
});
