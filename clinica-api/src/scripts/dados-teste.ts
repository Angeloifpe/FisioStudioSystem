/**
 * Cadastra dados fictícios para testes.
 *
 *   npm run dados-teste            cria os dados
 *   npm run dados-teste -- --limpar  apaga os pacientes de teste (e tudo ligado a eles)
 *
 * - Todos os pacientes de teste têm e-mail @teste.clinica e senha "teste123".
 * - Abre horários de segunda a sexta (menos feriados), de 3 semanas atrás até 3 semanas à frente
 *   (pula horários que já existem).
 * - Precisa que a conta da cliente já exista (npm run criar-admin).
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { pool } from '../db';

const DOMINIO = '@teste.clinica';
const SENHA = 'teste123';
const TZ = config.timezone;

type Modalidade = 'AVALIACAO' | 'FISIOTERAPIA' | 'PILATES';

async function limpar(c: PoolClient) {
  const ids = `SELECT p.id FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1`;
  await c.query(`DELETE FROM notificacoes WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM registros_atendimento WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM avaliacoes WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM mudancas_situacao WHERE paciente_id IN (${ids})`, [DOMINIO]);
  // remove primeiro os agendamentos que apontam para outros (reposição/remarcação)
  await c.query(
    `DELETE FROM agendamentos WHERE paciente_id IN (${ids}) AND (reposicao_de IS NOT NULL OR remarcado_de IS NOT NULL)`,
    [DOMINIO],
  );
  await c.query(`DELETE FROM agendamentos WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM pilates_fixos WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM pacientes WHERE id IN (${ids})`, [DOMINIO]);
  const r = await c.query(`DELETE FROM usuarios WHERE email LIKE '%' || $1`, [DOMINIO]);
  // Horários vazios que já não servem: fora do funcionamento ou da grade de
  // pilates (sobras de regras antigas) ou criados sob demanda para um atendimento
  const h = await c.query(
    `DELETE FROM horarios h
      WHERE NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.horario_id = h.id)
        AND (h.sob_demanda
             OR NOT fn_dentro_do_funcionamento(h.inicio, h.fim)
             OR NOT fn_respeita_grade_pilates(h.modalidade, h.inicio, h.fim))`,
  );
  return { pacientes: r.rowCount ?? 0, horarios: h.rowCount ?? 0 };
}

async function main() {
  const modoLimpar = process.argv.includes('--limpar');
  const c = await pool.connect();

  try {
    await c.query('BEGIN');

    if (modoLimpar) {
      const n = await limpar(c);
      await c.query('COMMIT');
      console.log(`Dados de teste removidos (${n.pacientes} paciente(s)). `
        + `${n.horarios} horário(s) vazio(s) fora das regras atuais apagado(s); os demais continuam na agenda.`);
      return;
    }

    const existe = await c.query(`SELECT 1 FROM usuarios WHERE email LIKE '%' || $1 LIMIT 1`, [DOMINIO]);
    if (existe.rowCount) {
      throw new Error('Os dados de teste já existem. Para recriar: npm run dados-teste -- --limpar  e depois  npm run dados-teste');
    }

    const admin = await c.query(`SELECT id FROM usuarios WHERE papel = 'ADMIN' ORDER BY criado_em LIMIT 1`);
    if (!admin.rowCount) throw new Error('Crie antes a conta da cliente: npm run criar-admin -- email senha');
    const adminId = admin.rows[0].id as string;

    // ------------------------------------------------------------------
    // Horários: dias em que a clínica abre (segunda a quinta), de 5 semanas
    // atrás até 5 semanas à frente, dentro do horário de funcionamento.
    // Pilates: todas as aulas da grade. Avaliação e fisioterapia: um horário
    // de cada por dia, nos intervalos entre as aulas de pilates.
    // Nos agendamentos abaixo, a "hora" escolhe a turma do dia:
    //   7 = avaliação · 8/9/10 = fisioterapia · 17/18/19 = pilates A/B/C
    //   turma       segunda        terça          quarta         quinta
    //   AVALIACAO   07:00 (1h)     10:30 (30min)  07:00 (1h)     10:30 (30min)
    //   FISIO       10:00 (1h)     10:00 (30min)  10:00 (1h)     08:00 (30min)
    //   PILATES_A   16:00          15:00          06:00          15:00
    //   PILATES_B   17:10          16:00          08:00          16:00
    //   PILATES_C   18:10          17:10          09:00          17:10
    // ------------------------------------------------------------------
    const grade: Record<number, Record<string, string>> = {
      1: { AVALIACAO: '07:00', FISIO: '10:00', PILATES_A: '16:00', PILATES_B: '17:10', PILATES_C: '18:10' },
      2: { AVALIACAO: '10:30', FISIO: '10:00', PILATES_A: '15:00', PILATES_B: '16:00', PILATES_C: '17:10' },
      3: { AVALIACAO: '07:00', FISIO: '10:00', PILATES_A: '06:00', PILATES_B: '08:00', PILATES_C: '09:00' },
      4: { AVALIACAO: '10:30', FISIO: '08:00', PILATES_A: '15:00', PILATES_B: '16:00', PILATES_C: '17:10' },
    };
    // Duração (min) da avaliação e da fisioterapia em cada dia da semana
    const duracaoDia: Record<number, number> = { 1: 60, 2: 30, 3: 60, 4: 30 };
    const turmaDe: Record<number, string> = {
      7: 'AVALIACAO', 8: 'FISIO', 9: 'FISIO', 10: 'FISIO', 17: 'PILATES_A', 18: 'PILATES_B', 19: 'PILATES_C',
    };
    const linhasGrade = Object.entries(grade).flatMap(([dia, turmas]) =>
      (['AVALIACAO', 'FISIO'] as const).map((turma) => ({
        dia: Number(dia),
        modalidade: turma === 'FISIO' ? 'FISIOTERAPIA' : 'AVALIACAO',
        hora: turmas[turma],
        minutos: duracaoDia[Number(dia)],
      })));

    const pilates = await c.query(
      'SELECT fn_abrir_aulas_pilates(current_date - 35, current_date + 35) AS n',
    );
    const horarios = await c.query(
      `INSERT INTO horarios (modalidade, inicio, fim)
       SELECT g.modalidade::modalidade,
              ((current_date + d) + g.hora::time) AT TIME ZONE $1,
              ((current_date + d) + g.hora::time + make_interval(mins => g.minutos)) AT TIME ZONE $1
         FROM generate_series(-35, 35) AS d
         JOIN unnest($2::int[], $3::text[], $4::text[], $5::int[]) AS g(dia, modalidade, hora, minutos)
           ON g.dia = extract(isodow FROM current_date + d)
        WHERE NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = current_date + d)
       ON CONFLICT DO NOTHING`,
      [TZ, linhasGrade.map((l) => l.dia), linhasGrade.map((l) => l.modalidade),
        linhasGrade.map((l) => l.hora), linhasGrade.map((l) => l.minutos)],
    );

    // Dias de atendimento em volta de hoje: util(0) = hoje (ou o próximo dia
    // de atendimento), util(1) = o seguinte, util(-1) = o anterior...
    const uteis = (await c.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia, extract(isodow FROM d)::int AS dow, d >= current_date AS futuro
         FROM generate_series(current_date - 40, current_date + 40, INTERVAL '1 day') AS d
        WHERE extract(isodow FROM d) BETWEEN 1 AND 4
          AND NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = d::date)
        ORDER BY d`,
    )).rows as { dia: string; dow: number; futuro: boolean }[];
    const hojeIdx = uteis.findIndex((u) => u.futuro);
    const util = (n: number) => uteis[hojeIdx + n];

    /** Id do horário da turma (escolhida pela hora) no dia n (0 = hoje); null se não existir. */
    async function horario(dia: number, hora: number, modalidade: Modalidade): Promise<string | null> {
      const d = util(dia);
      const turma = turmaDe[hora];
      if (!d || !turma) return null;
      const r = await c.query(
        `SELECT id FROM horarios
          WHERE modalidade = $1
            AND inicio = ($2::date + $3::time) AT TIME ZONE $4`,
        [modalidade, d.dia, grade[d.dow][turma], TZ],
      );
      return r.rows[0]?.id ?? null;
    }

    let pulados = 0;
    /** Agenda; se não der (horário ocupado pela agenda real, por exemplo), pula sem parar o script. */
    async function agendar(paciente: string, dia: number, hora: number, modalidade: Modalidade,
      extra: { experimental?: boolean; reposicao_de?: string; avaliacao_para?: string } = {}): Promise<string | null> {
      const h = await horario(dia, hora, modalidade);
      if (!h) { pulados++; return null; }
      await c.query('SAVEPOINT ag');
      try {
        const r = await c.query(
          `INSERT INTO agendamentos (paciente_id, horario_id, experimental, reposicao_de, avaliacao_para)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [paciente, h, extra.experimental ?? false, extra.reposicao_de ?? null, extra.avaliacao_para ?? null],
        );
        await c.query('RELEASE SAVEPOINT ag');
        return r.rows[0].id;
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT ag');
        pulados++;
        return null;
      }
    }

    async function realizado(agendamento: string | null, observacoes?: string) {
      if (!agendamento) return;
      await c.query(`UPDATE agendamentos SET status = 'REALIZADO', presenca_registrada_em = now() WHERE id = $1`, [agendamento]);
      if (observacoes) {
        await c.query(
          `INSERT INTO registros_atendimento (paciente_id, agendamento_id, data_atendimento, observacoes, criado_por)
           SELECT a.paciente_id, a.id, (h.inicio AT TIME ZONE $3)::date, $2, $4
             FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = $1`,
          [agendamento, observacoes, TZ, adminId],
        );
      }
    }

    async function falta(agendamento: string | null) {
      if (!agendamento) return;
      await c.query(`UPDATE agendamentos SET status = 'FALTA', presenca_registrada_em = now() WHERE id = $1`, [agendamento]);
    }

    async function avaliar(paciente: string, dia: number, resultado: 'LIBERADO' | 'NAO_LIBERADO', obs: string,
      para: 'PILATES' | 'FISIOTERAPIA') {
      const a = await agendar(paciente, dia, 7, 'AVALIACAO', { avaliacao_para: para });
      if (!a) return;
      await c.query('SELECT fn_concluir_avaliacao($1, $2, $3, $4)', [a, resultado, obs, adminId]);
      await c.query(`SELECT fn_notificar_agendamento('AVALIACAO_CONCLUIDA', $1)`, [a]);
    }

    const notificar = (tipo: string, agendamento: string | null) =>
      agendamento ? c.query('SELECT fn_notificar_agendamento($1, $2)', [tipo, agendamento]) : null;

    // ------------------------------------------------------------------
    // Pacientes
    // ------------------------------------------------------------------
    const hash = await bcrypt.hash(SENHA, 10);
    async function paciente(n: number, nome: string, email: string, nascimento: string, endereco: string) {
      const u = await c.query(
        `INSERT INTO usuarios (email, senha_hash, papel) VALUES ($1, $2, 'PACIENTE') RETURNING id`,
        [email + DOMINIO, hash],
      );
      const p = await c.query(
        `INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone, endereco)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [u.rows[0].id, nome, `9100000000${n}`, nascimento, `8199900000${n}`, endereco],
      );
      await c.query(`SELECT fn_notificar_paciente('CADASTRO_NOVO', $1)`, [p.rows[0].id]);
      return p.rows[0].id as string;
    }

    const ana = await paciente(1, 'Ana Lima', 'ana', '1988-02-14', 'Rua das Flores, 120 - Centro');
    const bruno = await paciente(2, 'Bruno Costa', 'bruno', '1979-07-30', 'Av. Brasil, 455 - Boa Vista');
    const carla = await paciente(3, 'Carla Mendes', 'carla', '1993-11-05', 'Rua São José, 78 - Santo Antônio');
    const diego = await paciente(4, 'Diego Rocha', 'diego', '1985-04-22', 'Rua do Sol, 9 - Centro');
    const elisa = await paciente(5, 'Elisa Freitas', 'elisa', '2000-09-18', 'Rua Nova, 300 - Cohab');
    const fabio = await paciente(6, 'Fábio Nunes', 'fabio', '1990-01-03', 'Travessa Sete, 12 - São Pedro');
    const gabriela = await paciente(7, 'Gabriela Souza', 'gabriela', '1972-06-27', 'Rua Primavera, 51 - Jardim');
    const henrique = await paciente(8, 'Henrique Alves', 'henrique', '1968-12-09', 'Av. Central, 1001 - Centro');

    // Avaliações passadas
    // Uma avaliação por modalidade: quem faz as duas fez duas avaliações
    await avaliar(ana, -14, 'LIBERADO', 'Dor lombar leve. Indicado pilates 2x por semana.', 'PILATES');
    await avaliar(bruno, -17, 'LIBERADO', 'Pós-operatório de joelho. Fisioterapia 2x por semana.', 'FISIOTERAPIA');
    await avaliar(bruno, -13, 'LIBERADO', 'Pode complementar com pilates 1x por semana.', 'PILATES');
    await avaliar(carla, -12, 'LIBERADO', 'Postura. Pilates.', 'PILATES');
    await avaliar(diego, -16, 'LIBERADO', 'Tendinite no ombro. Fisioterapia.', 'FISIOTERAPIA');
    await avaliar(diego, -11, 'LIBERADO', 'Liberado também para pilates.', 'PILATES');
    await avaliar(henrique, -10, 'LIBERADO', 'Reabilitação de tornozelo.', 'FISIOTERAPIA');
    await avaliar(gabriela, -4, 'NAO_LIBERADO', 'Precisa de liberação do cardiologista antes de iniciar.', 'PILATES');

    // Ana — pilates: histórico com presença e falta; próximas aulas (uma confirmada)
    await realizado(await agendar(ana, -9, 18, 'PILATES'), 'Boa execução dos exercícios de core.');
    await realizado(await agendar(ana, -6, 18, 'PILATES'), 'Relatou menos dor lombar.');
    await falta(await agendar(ana, -2, 18, 'PILATES'));
    // Ana tem horário fixo: terças e quintas às 16h (o sistema reserva todas as aulas)
    for (const diaSemana of [2, 4]) {
      const f = await c.query(`SELECT fn_fixar_pilates($1, $2::smallint, '16:00') AS id`, [ana, diaSemana]);
      const n = await c.query(`SELECT COUNT(*)::int AS n FROM agendamentos WHERE fixo_id = $1`, [f.rows[0].id]);
      await c.query(`SELECT fn_notificar_fixo($1, 'ADMIN', $2)`, [f.rows[0].id, n.rows[0].n]);
    }
    const anaProxima = await c.query(
      `SELECT a.id FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
        WHERE a.paciente_id = $1 AND a.fixo_id IS NOT NULL AND h.inicio > now()
        ORDER BY h.inicio LIMIT 1`, [ana]);
    if (anaProxima.rows[0]) {
      await c.query('UPDATE agendamentos SET presenca_confirmada_em = now() WHERE id = $1', [anaProxima.rows[0].id]);
      await notificar('PRESENCA_CONFIRMADA', anaProxima.rows[0].id);
    }

    // Bruno — fisioterapia com registros; também numa turma de pilates
    await realizado(await agendar(bruno, -8, 8, 'FISIOTERAPIA'), 'Ganho de amplitude: flexão 95°. Fortalecimento de quadríceps.');
    await realizado(await agendar(bruno, -5, 8, 'FISIOTERAPIA'), 'Flexão 105°. Iniciado treino de marcha.');
    await realizado(await agendar(bruno, -1, 8, 'FISIOTERAPIA'), 'Flexão 112°. Sem dor ao subir escadas.');
    await agendar(bruno, 1, 8, 'FISIOTERAPIA');
    // pediu cancelamento de uma fisioterapia (pendente para a cliente decidir)
    const brunoPedido = await agendar(bruno, 4, 9, 'FISIOTERAPIA');
    if (brunoPedido) {
      await c.query(
        `UPDATE agendamentos SET status = 'CANCELAMENTO_SOLICITADO', cancelamento_solicitado_em = now(),
                motivo_cancelamento = 'Consulta médica no mesmo horário' WHERE id = $1`,
        [brunoPedido],
      );
      await notificar('CANCELAMENTO_SOLICITADO', brunoPedido);
    }
    await agendar(bruno, 1, 18, 'PILATES');

    // Carla — pilates; avisou que não ia a uma aula e já remarcou em outra turma
    await realizado(await agendar(carla, -7, 17, 'PILATES'), 'Trabalho de alongamento cervical.');
    await agendar(carla, 1, 18, 'PILATES');
    const carlaAviso = await agendar(carla, 2, 17, 'PILATES');
    if (carlaAviso) {
      await c.query('SELECT fn_avisar_falta_pilates($1, $2, $3)', [carlaAviso, carla, 'Consulta médica no mesmo horário']);
      await agendar(carla, 3, 19, 'PILATES', { reposicao_de: carlaAviso });
    }

    // Diego — avisou que não ia a uma aula de pilates: remarcação liberada (ainda não usada)
    const diegoCancelada = await agendar(diego, 2, 19, 'PILATES');
    if (diegoCancelada) {
      await c.query('SELECT fn_avisar_falta_pilates($1, $2, $3)', [diegoCancelada, diego, 'Viagem a trabalho']);
    }
    await realizado(await agendar(diego, -3, 10, 'FISIOTERAPIA'), 'Liberação miofascial no ombro direito.');
    await agendar(diego, 1, 18, 'PILATES');
    await agendar(diego, 5, 10, 'FISIOTERAPIA');

    // Elisa — aguardando avaliação, com aula experimental (já paga via Pix) e avaliação marcadas
    const elisaExperimental = await agendar(elisa, 1, 19, 'PILATES', { experimental: true });
    await notificar('AULA_EXPERIMENTAL_MARCADA', elisaExperimental);
    if (elisaExperimental) {
      await c.query(`SELECT fn_registrar_pagamento_experimental($1, 'PIX', $2)`, [elisaExperimental, adminId]);
    }
    await notificar('AGENDAMENTO_CRIADO', await agendar(elisa, 2, 7, 'AVALIACAO', { avaliacao_para: 'PILATES' }));

    // Fábio — faltou duas vezes à aula experimental (gera o alerta para a cliente)
    await falta(await agendar(fabio, -5, 19, 'PILATES', { experimental: true }));
    await falta(await agendar(fabio, -3, 19, 'PILATES', { experimental: true }));

    // Henrique — recebeu alta
    await realizado(await agendar(henrique, -6, 9, 'FISIOTERAPIA'), 'Marcha normal, sem dor. Alta prevista.');
    await c.query('SELECT fn_mudar_situacao_paciente($1, $2, $3, $4)', [henrique, 'ALTA', 'Tratamento concluído', adminId]);
    await c.query(`SELECT fn_notificar_paciente('SITUACAO_ALTERADA', $1)`, [henrique]);

    // A cliente reduziu para 4 vagas a segunda turma de pilates do próximo dia
    // de atendimento (capacidade de uma aula num dia específico)
    const turmaCheia = await horario(1, 18, 'PILATES');
    if (turmaCheia) {
      await c.query(
        `UPDATE horarios SET capacidade = GREATEST(4,
           (SELECT COUNT(*) FROM agendamentos WHERE horario_id = $1 AND status <> 'CANCELADO'))
          WHERE id = $1`,
        [turmaCheia],
      );
    }

    // Duração da sessão de fisioterapia (sem definir: 30 min)
    await c.query('UPDATE pacientes SET duracao_fisioterapia_min = 45 WHERE id = $1', [bruno]);
    await c.query('UPDATE pacientes SET duracao_fisioterapia_min = 60 WHERE id = $1', [diego]);

    await c.query('COMMIT');

    console.log('Dados de teste criados!');
    console.log(`- ${pilates.rows[0].n} aulas de pilates (grade completa) e ${horarios.rowCount} horários de avaliação e fisioterapia, de 5 semanas atrás até 5 semanas à frente`);
    if (pulados) console.log(`- ${pulados} agendamento(s) pulado(s) porque o horário já estava ocupado na sua agenda`);
    console.log('');
    console.log(`Pacientes (senha de todos: ${SENHA}):`);
    console.log(`  ana${DOMINIO}       Ana Lima        liberada só para pilates · pilates fixo às terças e quintas 16h`);
    console.log(`  bruno${DOMINIO}     Bruno Costa     liberado para os dois (2 avaliações) · fisioterapia com histórico · pedido de cancelamento esperando a cliente · sessão de 45 min`);
    console.log(`  carla${DOMINIO}     Carla Mendes    liberada só para pilates · avisou falta no pilates e remarcou em outra turma`);
    console.log(`  diego${DOMINIO}     Diego Rocha     liberado · avisou falta no pilates: remarcação liberada para usar · sessão de 60 min`);
    console.log(`  elisa${DOMINIO}     Elisa Freitas   aguardando avaliação · aula experimental paga (Pix) e avaliação de pilates marcadas`);
    console.log(`  fabio${DOMINIO}     Fábio Nunes     aguardando avaliação · 2 faltas em aula experimental (alerta)`);
    console.log(`  gabriela${DOMINIO}  Gabriela Souza  não liberada na avaliação`);
    console.log(`  henrique${DOMINIO}  Henrique Alves  recebeu alta`);
    console.log('');
    console.log('Turmas de pilates com 8 vagas; no próximo dia de atendimento a segunda turma foi reduzida para 4 vagas e fica cheia ou quase (Bruno, Carla, Diego e, se cair terça ou quinta, Ana às 16h).');
  } catch (erro) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Erro: ' + (erro as Error).message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

main();
