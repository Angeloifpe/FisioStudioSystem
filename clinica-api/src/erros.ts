import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** Erro com status HTTP, lançado pelas rotas. */
export class ErroHttp extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const naoEncontrado = (o: string) => new ErroHttp(404, `${o} não encontrado`);

// Mensagens amigáveis para as restrições do banco
const mensagensRestricao: Record<string, string> = {
  usuarios_email_key: 'Já existe uma conta com este e-mail',
  pacientes_cpf_key: 'Já existe um paciente com este CPF',
  pacientes_cpf_check: 'CPF deve ter 11 dígitos, só números',
  uq_agendamento_ativo_paciente_horario: 'Você já está agendado neste horário',
  uq_aula_experimental_por_paciente: 'Você já tem uma aula experimental agendada ou realizada (aula paga em que faltou conta como dada)',
  uq_reposicao_usada_uma_vez: 'Esta reposição já foi usada',
  ex_horarios_sem_sobreposicao: 'Já existe um horário que se sobrepõe a este',
  horarios_check: 'O fim do horário precisa ser depois do início',
  ck_horarios_dias_uteis: 'A clínica funciona de segunda a sexta',
  pilates_fixos_dia_semana_check: 'A clínica funciona de segunda a sexta',
  uq_pilates_fixo_dia: 'Você já tem um horário fixo neste dia da semana',
};

export const tratarErros: ErrorRequestHandler = (erro, _req, res, _next) => {
  if (erro instanceof ErroHttp) {
    res.status(erro.status).json({ erro: erro.message });
    return;
  }

  if (erro instanceof ZodError) {
    res.status(400).json({
      erro: 'Dados inválidos',
      campos: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    });
    return;
  }

  // Erros do PostgreSQL
  if (erro && typeof erro.code === 'string') {
    const restricao = erro.constraint as string | undefined;
    const amigavel = restricao ? mensagensRestricao[restricao] : undefined;

    switch (erro.code) {
      case 'P0001': // RAISE EXCEPTION dos gatilhos e funções (regra de negócio)
        res.status(422).json({ erro: erro.message });
        return;
      case '23505': // unique_violation
      case '23P01': // exclusion_violation
        res.status(409).json({ erro: amigavel ?? 'Registro em conflito com outro já existente' });
        return;
      case '23514': // check_violation
      case '23502': // not_null_violation
        res.status(422).json({ erro: amigavel ?? 'Dados não respeitam as regras do banco' });
        return;
      case '23503': // foreign_key_violation
        res.status(422).json({ erro: 'Referência a um registro que não existe' });
        return;
      case '22P02': // invalid_text_representation (ex.: UUID mal formado)
        res.status(400).json({ erro: 'Identificador ou valor em formato inválido' });
        return;
    }
  }

  console.error(erro);
  res.status(500).json({ erro: 'Erro interno no servidor' });
};
