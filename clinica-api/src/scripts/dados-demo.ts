/**
 * Dados de demonstração: a clínica "já em funcionamento".
 *
 *   npm run dados-demo              cria os dados
 *   npm run dados-demo -- --limpar  apaga tudo o que este script criou
 *
 * - ~30 pacientes com e-mail @demo.clinica e senha "demo123".
 * - ~8 semanas de histórico (avaliações, aulas de pilates, fisioterapia, faltas,
 *   observações) e 2 semanas de agenda futura já preenchida.
 * - Se ainda não existir conta da cliente (ADMIN), cria admin@demo.clinica / demo123.
 * - Respeita as regras do banco: tudo passa pelas funções e gatilhos oficiais.
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { pool } from '../db';

const DOMINIO = '@demo.clinica';
const SENHA = 'demo123';
const TZ = config.timezone;

type Modalidade = 'AVALIACAO' | 'FISIOTERAPIA' | 'PILATES';
type Para = 'PILATES' | 'FISIOTERAPIA';

// Gerador pseudo-aleatório fixo: o histórico sai igual toda vez que o script roda
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261123);

async function limpar(c: PoolClient) {
  const ids = `SELECT p.id FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1`;
  await c.query(`DELETE FROM notificacoes WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM registros_atendimento WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM avaliacoes WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM mudancas_situacao WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(
    `DELETE FROM agendamentos WHERE paciente_id IN (${ids}) AND (reposicao_de IS NOT NULL OR remarcado_de IS NOT NULL)`,
    [DOMINIO],
  );
  await c.query(`DELETE FROM agendamentos WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM pilates_fixos WHERE paciente_id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM pacientes WHERE id IN (${ids})`, [DOMINIO]);
  await c.query(`DELETE FROM mudancas_situacao WHERE alterado_por IN (SELECT id FROM usuarios WHERE email LIKE '%' || $1)`, [DOMINIO]);
  const r = await c.query(`DELETE FROM usuarios WHERE email LIKE '%' || $1 AND papel = 'PACIENTE'`, [DOMINIO]);
  // Horários vazios criados para a demonstração (avaliação/fisioterapia) e sobras fora das regras
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
      console.log(`Dados de demonstração removidos (${n.pacientes} paciente(s)); ${n.horarios} horário(s) vazio(s) apagado(s).`);
      return;
    }

    const existe = await c.query(`SELECT 1 FROM usuarios WHERE email LIKE '%' || $1 AND papel = 'PACIENTE' LIMIT 1`, [DOMINIO]);
    if (existe.rowCount) {
      throw new Error('Os dados de demonstração já existem. Para recriar: npm run dados-demo -- --limpar  e depois  npm run dados-demo');
    }

    const hash = await bcrypt.hash(SENHA, 10);

    // ---- conta da cliente ----------------------------------------------------
    let admin = await c.query(`SELECT id, email FROM usuarios WHERE papel = 'ADMIN' ORDER BY criado_em LIMIT 1`);
    let adminCriado = false;
    if (!admin.rowCount) {
      admin = await c.query(
        `INSERT INTO usuarios (email, senha_hash, papel) VALUES ($1, $2, 'ADMIN') RETURNING id, email`,
        ['admin' + DOMINIO, hash],
      );
      adminCriado = true;
    }
    const adminId = admin.rows[0].id as string;
    const adminEmail = admin.rows[0].email as string;

    // ---- horários: 9 semanas atrás até 6 semanas à frente ---------------------
    // Clínica fechada na sexta. Avaliação e fisioterapia só cabem entre as aulas de pilates
    // (a clínica atende uma coisa por vez).
    //   seg/qua: fisio 07:00 e 07:30 (30 min) · avaliação 10:00 (1h)
    //   ter:     fisio 10:00 (30 min)         · avaliação 10:30 (30 min)
    //   qui:     fisio 08:00 (30 min)         · avaliação 10:30 (30 min)
    const padrao: { dia: number; modalidade: Modalidade; hora: string; min: number }[] = [
      { dia: 1, modalidade: 'FISIOTERAPIA', hora: '07:00', min: 30 },
      { dia: 1, modalidade: 'FISIOTERAPIA', hora: '07:30', min: 30 },
      { dia: 1, modalidade: 'AVALIACAO', hora: '10:00', min: 60 },
      { dia: 2, modalidade: 'FISIOTERAPIA', hora: '10:00', min: 30 },
      { dia: 2, modalidade: 'AVALIACAO', hora: '10:30', min: 30 },
      { dia: 3, modalidade: 'FISIOTERAPIA', hora: '07:00', min: 30 },
      { dia: 3, modalidade: 'FISIOTERAPIA', hora: '07:30', min: 30 },
      { dia: 3, modalidade: 'AVALIACAO', hora: '10:00', min: 60 },
      { dia: 4, modalidade: 'FISIOTERAPIA', hora: '08:00', min: 30 },
      { dia: 4, modalidade: 'AVALIACAO', hora: '10:30', min: 30 },
    ];
    const horaAval: Record<number, string> = { 1: '10:00', 2: '10:30', 3: '10:00', 4: '10:30' };

    const pilates = await c.query('SELECT fn_abrir_aulas_pilates(current_date - 63, current_date + 42) AS n');
    await c.query(
      `INSERT INTO horarios (modalidade, inicio, fim)
       SELECT g.modalidade::modalidade,
              ((current_date + d) + g.hora::time) AT TIME ZONE $1,
              ((current_date + d) + g.hora::time + make_interval(mins => g.minutos)) AT TIME ZONE $1
         FROM generate_series(-63, 42) AS d
         JOIN unnest($2::int[], $3::text[], $4::text[], $5::int[]) AS g(dia, modalidade, hora, minutos)
           ON g.dia = extract(isodow FROM current_date + d)
        WHERE NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = current_date + d)
       ON CONFLICT DO NOTHING`,
      [TZ, padrao.map((p) => p.dia), padrao.map((p) => p.modalidade), padrao.map((p) => p.hora), padrao.map((p) => p.min)],
    );

    // ---- dias de atendimento (segunda a quinta, sem feriado) ------------------
    type Dia = { dia: string; dow: number; sem: number; passado: boolean };
    const uteis = (await c.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia, extract(isodow FROM d)::int AS dow,
              floor((d::date - date_trunc('week', current_date)::date) / 7.0)::int AS sem,
              d::date < current_date AS passado
         FROM generate_series(current_date - 70, current_date + 45, INTERVAL '1 day') AS d
        WHERE extract(isodow FROM d) BETWEEN 1 AND 4
          AND NOT EXISTS (SELECT 1 FROM feriados f WHERE f.data = d::date)
        ORDER BY d`,
    )).rows as Dia[];
    const hojeStr = (await c.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d as string;
    const diaDe = (sem: number, dow: number) => uteis.find((u) => u.sem === sem && u.dow === dow);
    /** k-ésimo dia de atendimento depois de hoje (1 = o próximo). */
    const futuro = (k: number) => uteis.filter((u) => u.dia > hojeStr)[k - 1];
    const futuros = uteis.filter((u) => u.dia > hojeStr);
    const passados = uteis.filter((u) => u.passado);

    let pulados = 0;
    const motivosPulo: string[] = [];

    async function horarioEm(d: Dia | undefined, modalidade: Modalidade, hora: string): Promise<string | null> {
      if (!d) return null;
      const r = await c.query(
        `SELECT id FROM horarios
          WHERE modalidade = $1 AND NOT cancelado AND inicio = ($2::date + $3::time) AT TIME ZONE $4`,
        [modalidade, d.dia, hora, TZ],
      );
      return r.rows[0]?.id ?? null;
    }

    async function agendar(paciente: string, d: Dia | undefined, modalidade: Modalidade, hora: string,
      extra: { experimental?: boolean; reposicao_de?: string; avaliacao_para?: Para } = {}): Promise<string | null> {
      const h = await horarioEm(d, modalidade, hora);
      if (!h) { pulados++; motivosPulo.push(`${modalidade} ${d?.dia} ${hora}: horário não existe`); return null; }
      await c.query('SAVEPOINT ag');
      try {
        const r = await c.query(
          `INSERT INTO agendamentos (paciente_id, horario_id, experimental, reposicao_de, avaliacao_para)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [paciente, h, extra.experimental ?? false, extra.reposicao_de ?? null, extra.avaliacao_para ?? null],
        );
        await c.query('RELEASE SAVEPOINT ag');
        return r.rows[0].id;
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT ag');
        pulados++;
        motivosPulo.push(`${modalidade} ${d?.dia} ${hora}: ${(e as Error).message}`);
        return null;
      }
    }

    async function realizado(ag: string | null, obs?: string) {
      if (!ag) return;
      await c.query(`UPDATE agendamentos SET status = 'REALIZADO', presenca_registrada_em = now() WHERE id = $1`, [ag]);
      if (obs) {
        await c.query(
          `INSERT INTO registros_atendimento (paciente_id, agendamento_id, data_atendimento, observacoes, criado_por)
           SELECT a.paciente_id, a.id, (h.inicio AT TIME ZONE $3)::date, $2, $4
             FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = $1`,
          [ag, obs, TZ, adminId],
        );
      }
    }
    async function falta(ag: string | null) {
      if (!ag) return;
      await c.query(`UPDATE agendamentos SET status = 'FALTA', presenca_registrada_em = now() WHERE id = $1`, [ag]);
    }
    const notificar = (tipo: string, ag: string | null) =>
      ag ? c.query('SELECT fn_notificar_agendamento($1, $2)', [tipo, ag]) : null;

    // ---- pacientes ----------------------------------------------------------
    let seq = 0;
    async function paciente(nome: string, email: string, nasc: string, tel: string, endereco: string) {
      seq++;
      const u = await c.query(
        `INSERT INTO usuarios (email, senha_hash, papel) VALUES ($1, $2, 'PACIENTE') RETURNING id`,
        [email + DOMINIO, hash],
      );
      const p = await c.query(
        `INSERT INTO pacientes (usuario_id, nome_completo, cpf, data_nascimento, telefone, endereco)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [u.rows[0].id, nome, String(90000000000 + seq * 7919), nasc, tel, endereco],
      );
      await c.query(`SELECT fn_notificar_paciente('CADASTRO_NOVO', $1)`, [p.rows[0].id]);
      return p.rows[0].id as string;
    }

    // Fila de avaliações já realizadas: 4 por semana (seg, ter, qua, qui), da mais antiga para a mais nova
    let slotAval = 0;
    const SEM_INICIAL = -8;
    function proximoSlotAval(): Dia {
      for (;;) {
        const sem = SEM_INICIAL + Math.floor(slotAval / 4);
        const dow = (slotAval % 4) + 1;
        slotAval++;
        const d = diaDe(sem, dow);
        if (d && d.passado) return d;
        if (sem >= 0) throw new Error('Fila de avaliações esgotada');
      }
    }
    async function avaliar(pac: string, resultado: 'LIBERADO' | 'NAO_LIBERADO', obs: string, para: Para): Promise<Dia | null> {
      const d = proximoSlotAval();
      const a = await agendar(pac, d, 'AVALIACAO', horaAval[d.dow], { avaliacao_para: para });
      if (!a) return null;
      await c.query('SELECT fn_concluir_avaliacao($1, $2, $3, $4)', [a, resultado, obs, adminId]);
      await c.query(`SELECT fn_notificar_agendamento('AVALIACAO_CONCLUIDA', $1)`, [a]);
      await c.query(`UPDATE pacientes SET criado_em = $2::date - 3 WHERE id = $1 AND criado_em > $2::date - 3`, [pac, d.dia]);
      return d;
    }

    const pick = <T,>(lista: T[], i: number) => lista[Math.min(i, lista.length - 1)];

    const obsPilates = [
      'Boa execução dos exercícios de core.', 'Trabalhou mobilidade de coluna torácica.', 'Evoluiu na carga do reformer.',
      'Relatou menos dor lombar.', 'Foco em estabilização de escápulas.', 'Alongamento de cadeia posterior.',
      'Ótima consciência corporal hoje.', 'Fortalecimento de glúteo médio.', 'Respiração coordenada com o movimento.',
    ];

    /** Histórico de aulas de pilates nos dias da turma, desde o dia depois da avaliação até ontem. */
    async function historicoPilates(pac: string, turmas: [number, string][], apos: Dia, faltaProb = 0.08) {
      let n = 0;
      for (const d of passados) {
        if (d.dia <= apos.dia) continue;
        for (const [dow, hora] of turmas) {
          if (d.dow !== dow) continue;
          const ag = await agendar(pac, d, 'PILATES', hora);
          if (!ag) continue;
          const x = rnd();
          if (x < faltaProb) await falta(ag);
          else { n++; await realizado(ag, n % 3 === 1 ? obsPilates[Math.floor(rnd() * obsPilates.length)] : undefined); }
        }
      }
    }

    /** Fixa as turmas (reserva as aulas futuras). */
    async function fixar(pac: string, turmas: [number, string][]) {
      for (const [dow, hora] of turmas) {
        await c.query('SAVEPOINT fx');
        try {
          const f = await c.query(`SELECT fn_fixar_pilates($1, $2::smallint, $3::time) AS id`, [pac, dow, hora]);
          const n = await c.query(`SELECT COUNT(*)::int AS n FROM agendamentos WHERE fixo_id = $1`, [f.rows[0].id]);
          await c.query(`SELECT fn_notificar_fixo($1, 'ADMIN', $2)`, [f.rows[0].id, n.rows[0].n]);
          await c.query('RELEASE SAVEPOINT fx');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT fx');
          motivosPulo.push(`fixar dow ${dow} ${hora}: ${(e as Error).message}`);
        }
      }
    }

    /** Aula futura (do fixo) de um paciente no k-ésimo dia de atendimento depois de hoje. */
    async function aulaFutura(pac: string, d: Dia | undefined, hora: string): Promise<string | null> {
      const h = await horarioEm(d, 'PILATES', hora);
      if (!h) return null;
      const r = await c.query(`SELECT id FROM agendamentos WHERE paciente_id = $1 AND horario_id = $2 AND status = 'AGENDADO'`, [pac, h]);
      return r.rows[0]?.id ?? null;
    }

    // ------------------------------------------------------------------------
    // 1) Alunos de pilates com horário fixo
    // ------------------------------------------------------------------------
    type Fixo = { nome: string; email: string; nasc: string; tel: string; end: string; turmas: [number, string][]; obs: string; faltas?: number };
    const fixos: Fixo[] = [
      { nome: 'Ana Lima', email: 'ana', nasc: '1988-02-14', tel: '81999010001', end: 'Rua das Flores, 120 - Centro', turmas: [[2, '16:00'], [4, '16:00']], obs: 'Dor lombar leve. Indicado pilates 2x por semana.' },
      { nome: 'Beatriz Campos', email: 'beatriz', nasc: '1991-05-22', tel: '81999010002', end: 'Rua do Futuro, 45 - Graças', turmas: [[1, '06:00'], [3, '06:00']], obs: 'Sedentária, quer ganhar condicionamento. Pilates 2x por semana.' },
      { nome: 'Carlos Eduardo Melo', email: 'carlos', nasc: '1983-09-03', tel: '81999010003', end: 'Av. Conde da Boa Vista, 800 - Boa Vista', turmas: [[1, '18:10'], [4, '18:10']], obs: 'Rigidez cervical por trabalho em computador. Pilates indicado.' },
      { nome: 'Daniela Pires', email: 'daniela', nasc: '1976-12-18', tel: '81999010004', end: 'Rua Sete de Setembro, 210 - Casa Forte', turmas: [[2, '08:00'], [4, '08:30']], obs: 'Osteopenia leve. Exercícios de fortalecimento com carga progressiva.' },
      { nome: 'Eduardo Barros', email: 'eduardo', nasc: '1969-03-27', tel: '81999010005', end: 'Rua Pedro Álvares, 33 - Madalena', turmas: [[1, '16:00'], [4, '15:00']], obs: 'Hérnia de disco L4-L5 estável. Pilates terapêutico.' },
      { nome: 'Fernanda Lopes', email: 'fernanda', nasc: '1995-07-09', tel: '81999010006', end: 'Rua Aurora, 502 - Soledade', turmas: [[2, '17:10'], [4, '17:10']], obs: 'Corredora amadora, busca prevenção de lesões.' },
      { nome: 'Gustavo Ramos', email: 'gustavo', nasc: '1987-01-30', tel: '81999010007', end: 'Rua da Hora, 67 - Espinheiro', turmas: [[3, '08:00']], obs: 'Postura. Pilates 1x por semana.' },
      { nome: 'Helena Duarte', email: 'helena', nasc: '1960-10-11', tel: '81999010008', end: 'Av. Domingos Ferreira, 1500 - Boa Viagem', turmas: [[1, '08:00'], [3, '08:00']], obs: 'Artrose de joelho leve. Pilates adaptado.' },
      { nome: 'Igor Teixeira', email: 'igor', nasc: '1998-04-15', tel: '81999010009', end: 'Rua Marquês de Olinda, 88 - Recife Antigo', turmas: [[2, '18:10'], [4, '18:10']], obs: 'Praticante de crossfit, melhorar mobilidade de quadril.' },
      { nome: 'Juliana Prado', email: 'juliana', nasc: '1985-06-25', tel: '81999010010', end: 'Rua Real da Torre, 301 - Torre', turmas: [[1, '17:10'], [3, '09:00']], obs: 'Pós-parto (8 meses). Fortalecimento de assoalho pélvico e core.' },
      { nome: 'Kleber Santos', email: 'kleber', nasc: '1974-08-02', tel: '81999010011', end: 'Rua Gervásio Pires, 14 - Boa Vista', turmas: [[2, '15:00'], [4, '16:00']], obs: 'Escoliose funcional. Pilates 2x por semana.' },
      { nome: 'Larissa Monteiro', email: 'larissa', nasc: '1992-11-14', tel: '81999010012', end: 'Rua Bom Pastor, 77 - Iputinga', turmas: [[1, '09:00'], [3, '09:00']], obs: 'Tensão em ombros e pescoço. Pilates indicado.' },
      { nome: 'Marcos Vinícius Neto', email: 'marcos', nasc: '1980-02-08', tel: '81999010013', end: 'Av. Caxangá, 2200 - Cordeiro', turmas: [[2, '09:00'], [4, '09:30']], obs: 'Retorno à atividade física após longo período parado.' },
      { nome: 'Natália Cardoso', email: 'natalia', nasc: '2001-03-19', tel: '81999010014', end: 'Rua João Ivo da Silva, 9 - Várzea', turmas: [[2, '16:00'], [4, '17:10']], obs: 'Hiperlordose. Fortalecimento abdominal e alongamento.' },
    ];

    const pacs: Record<string, string> = {};
    const avaliacaoFixa: Record<string, Dia | null> = {};
    const cronologia: (() => Promise<void>)[] = [];

    // A ordem da fila de avaliações é a cronológica: Henrique, Bruno (fisio), Yara, os fixos, ...
    // 0 Henrique (fisio) e 1 Bruno (fisio) — criados já, junto com a fila
    const henrique = await paciente('Henrique Alves', 'henrique', '1968-12-09', '81999020001', 'Av. Central, 1001 - Centro');
    const bruno = await paciente('Bruno Costa', 'bruno', '1979-07-30', '81999020002', 'Av. Brasil, 455 - Boa Vista');
    const yara = await paciente('Yara Fonseca', 'yara', '1989-08-21', '81999020003', 'Rua da Paz, 18 - Afogados');
    const avHenrique = await avaliar(henrique, 'LIBERADO', 'Reabilitação de tornozelo (entorse grau II). Fisioterapia 2x por semana.', 'FISIOTERAPIA');
    const avBrunoF = await avaliar(bruno, 'LIBERADO', 'Pós-operatório de joelho (LCA). Fisioterapia 2x por semana.', 'FISIOTERAPIA');
    const avYara = await avaliar(yara, 'LIBERADO', 'Dor cervical. Pilates.', 'PILATES');

    for (const f of fixos) {
      pacs[f.email] = await paciente(f.nome, f.email, f.nasc, f.tel, f.end);
      avaliacaoFixa[f.email] = await avaliar(pacs[f.email], 'LIBERADO', f.obs, 'PILATES');
    }

    // fila continua: Natália já foi; agora Otávio (F), Carla (P), Bruno (P), Patrícia (F), Diego (F), Sabrina (P),
    // Úrsula (não liberada), Diego (P), Gabriela (não liberada)
    const otavio = await paciente('Otávio Lima', 'otavio', '1972-05-05', '81999020004', 'Rua do Riachuelo, 360 - Boa Vista');
    const avOtavio = await avaliar(otavio, 'LIBERADO', 'Tendinopatia do manguito rotador. Fisioterapia semanal.', 'FISIOTERAPIA');
    const carla = await paciente('Carla Mendes', 'carla', '1993-11-05', '81999020005', 'Rua São José, 78 - Santo Antônio');
    const avCarla = await avaliar(carla, 'LIBERADO', 'Postura. Pilates (aulas avulsas, horários variáveis).', 'PILATES');
    const avBrunoP = await avaliar(bruno, 'LIBERADO', 'Pode complementar com pilates 1x por semana.', 'PILATES');
    const patricia = await paciente('Patrícia Gomes', 'patricia', '1965-09-29', '81999020006', 'Rua Santa Cruz, 140 - Parnamirim');
    const avPatricia = await avaliar(patricia, 'LIBERADO', 'Lombalgia crônica. Fisioterapia semanal.', 'FISIOTERAPIA');
    const diego = await paciente('Diego Rocha', 'diego', '1985-04-22', '81999020007', 'Rua do Sol, 9 - Centro');
    const avDiegoF = await avaliar(diego, 'LIBERADO', 'Tendinite no ombro direito. Fisioterapia 2x por semana.', 'FISIOTERAPIA');
    const sabrina = await paciente('Sabrina Dias', 'sabrina', '1990-02-02', '81999020008', 'Rua Imperial, 905 - São José');
    await avaliar(sabrina, 'LIBERADO', 'Liberada para pilates. Ainda vai escolher a turma.', 'PILATES');
    const ursula = await paciente('Úrsula Vieira', 'ursula', '1957-01-17', '81999020009', 'Av. Rui Barbosa, 1230 - Graças');
    await avaliar(ursula, 'NAO_LIBERADO', 'Hipertensão não controlada. Precisa de liberação do cardiologista.', 'PILATES');
    await avaliar(diego, 'LIBERADO', 'Liberado também para pilates.', 'PILATES');
    const gabriela = await paciente('Gabriela Souza', 'gabriela', '1972-06-27', '81999020010', 'Rua Primavera, 51 - Jardim São Paulo');
    await avaliar(gabriela, 'NAO_LIBERADO', 'Precisa de liberação do cardiologista antes de iniciar.', 'PILATES');

    // ------------------------------------------------------------------------
    // 2) Histórico de aulas e turmas fixas
    // ------------------------------------------------------------------------
    for (const f of fixos) {
      const av = avaliacaoFixa[f.email];
      if (!av) continue;
      await historicoPilates(pacs[f.email], f.turmas, av);
    }
    // Bruno: pilates 1x (terça 15h) depois da avaliação de pilates
    if (avBrunoP) await historicoPilates(bruno, [[2, '15:00']], avBrunoP);
    // Carla: aulas avulsas (sem turma fixa)
    if (avCarla) {
      let k = 0;
      for (const d of passados.filter((u) => u.dia > avCarla.dia && (u.dow === 1 || u.dow === 4))) {
        const hora = d.dow === 1 ? '17:10' : '18:10';
        const ag = await agendar(carla, d, 'PILATES', hora);
        if (++k % 4 === 0) await falta(ag); else await realizado(ag, k % 3 === 0 ? 'Trabalho de alongamento cervical.' : undefined);
      }
    }
    // Yara: algumas aulas avulsas e depois interrompeu
    if (avYara) {
      let k = 0;
      for (const d of passados.filter((u) => u.dia > avYara.dia && u.sem <= -5 && (u.dow === 2 || u.dow === 3))) {
        const ag = await agendar(yara, d, 'PILATES', d.dow === 2 ? '09:00' : '09:00');
        if (++k === 5) await falta(ag); else await realizado(ag, k === 2 ? 'Boa tolerância ao exercício.' : undefined);
      }
    }
    // Diego: nenhuma aula de pilates ainda (acabou de ser liberado)

    // Fixar as turmas (reserva as aulas futuras)
    for (const f of fixos) await fixar(pacs[f.email], f.turmas);
    if (avBrunoP) await fixar(bruno, [[2, '15:00']]);

    // ------------------------------------------------------------------------
    // 3) Fisioterapia: histórico + agenda futura
    // ------------------------------------------------------------------------
    const obsHenrique = [
      'Edema residual no tornozelo. Crioterapia e mobilização articular.', 'Início de exercícios proprioceptivos.',
      'Ganho de dorsiflexão: 12°. Fortalecimento de fibulares.', 'Apoio unipodal por 20 s. Treino de marcha.',
      'Sem dor ao caminhar. Iniciado trote leve.', 'Força de fibulares grau 5. Marcha normal, sem dor. Alta prevista.',
    ];
    const obsBruno = [
      'Pós-operatório 2 semanas. Flexão 80°. Crioterapia e exercícios isométricos.', 'Flexão 95°. Fortalecimento de quadríceps.',
      'Flexão 105°. Iniciado treino de marcha.', 'Flexão 112°. Sem dor ao subir escadas.', 'Flexão 120°. Agachamento parcial sem carga.',
      'Flexão 125°. Bicicleta ergométrica 10 min.', 'Flexão 130°. Treino de equilíbrio unipodal.', 'Boa evolução. Extensão completa, sem derrame articular.',
    ];
    const obsDiego = [
      'Dor no ombro direito 7/10. Liberação miofascial e eletroterapia.', 'Dor 5/10. Mobilização escapular.',
      'Dor 4/10. Fortalecimento de manguito rotador com elástico.', 'Dor 3/10. Ganho de amplitude em abdução: 150°.',
      'Dor 2/10. Exercícios excêntricos.',
    ];
    const obsOtavio = ['Dor ao elevar o braço acima da cabeça. Terapia manual e exercícios pendulares.', 'Melhora de amplitude. Fortalecimento de rotadores.', 'Dor 3/10. Exercícios em cadeia fechada.'];
    const obsPatricia = ['Lombalgia 6/10. Terapia manual e alongamento de isquiotibiais.', 'Dor 5/10. Exercícios de estabilização lombar.', 'Dor 4/10. Orientações ergonômicas e fortalecimento de core.', 'Dor 3/10. Mantendo exercícios em casa.'];

    /** Sessões passadas: nos dias da semana indicados (dow → hora), após o dia dado e até a semana-limite. */
    async function historicoFisio(pac: string, agenda: [number, string][], apos: Dia, ate: number, obs: string[], faltas: number[] = []) {
      let i = 0;
      for (const d of passados) {
        if (d.dia <= apos.dia || d.sem > ate) continue;
        for (const [dow, hora] of agenda) {
          if (d.dow !== dow) continue;
          const ag = await agendar(pac, d, 'FISIOTERAPIA', hora);
          if (!ag) continue;
          if (faltas.includes(i)) await falta(ag);
          else await realizado(ag, pick(obs, i));
          i++;
        }
      }
    }
    /** Sessões marcadas para os próximos dias (a partir de amanhã). */
    async function futuroFisio(pac: string, agenda: [number, string][], semanas = 2): Promise<string[]> {
      const limite = futuros.filter((u) => u.sem <= semanas);
      const ids: string[] = [];
      for (const d of limite) {
        for (const [dow, hora] of agenda) {
          if (d.dow !== dow) continue;
          const ag = await agendar(pac, d, 'FISIOTERAPIA', hora);
          if (ag) ids.push(ag);
        }
      }
      return ids;
    }

    if (avHenrique) await historicoFisio(henrique, [[1, '07:30'], [3, '07:30']], avHenrique, -4, obsHenrique);
    if (avBrunoF) await historicoFisio(bruno, [[1, '07:00'], [3, '07:00']], avBrunoF, -1, obsBruno, [5]);
    if (avDiegoF) await historicoFisio(diego, [[1, '07:30'], [3, '07:30']], avDiegoF, -1, obsDiego);
    if (avOtavio) await historicoFisio(otavio, [[4, '08:00']], avOtavio, -1, obsOtavio);
    if (avPatricia) await historicoFisio(patricia, [[2, '10:00']], avPatricia, -1, obsPatricia, [1]);

    const brunoFuturo = await futuroFisio(bruno, [[1, '07:00'], [3, '07:00']]);
    await futuroFisio(diego, [[1, '07:30'], [3, '07:30']]);
    await futuroFisio(otavio, [[4, '08:00']]);
    await futuroFisio(patricia, [[2, '10:00']]);

    // Hoje (segunda): o paciente do início da manhã já foi atendido
    const hoje = uteis.find((u) => u.dia === hojeStr);
    if (hoje && hoje.dow === 1) {
      await realizado(await agendar(bruno, hoje, 'FISIOTERAPIA', '07:00'), 'Boa evolução. Extensão completa, sem derrame articular.');
      await realizado(await agendar(diego, hoje, 'FISIOTERAPIA', '07:30'), 'Dor 2/10. Exercícios excêntricos.');
    }

    // Alta do Henrique
    await c.query('SELECT fn_mudar_situacao_paciente($1, $2, $3, $4)', [henrique, 'ALTA', 'Tratamento concluído com sucesso', adminId]);
    await c.query(`SELECT fn_notificar_paciente('SITUACAO_ALTERADA', $1)`, [henrique]);
    // Yara interrompeu o tratamento
    await c.query('SELECT fn_mudar_situacao_paciente($1, $2, $3, $4)', [yara, 'INTERROMPIDO', 'Mudou de cidade', adminId]);
    await c.query(`SELECT fn_notificar_paciente('SITUACAO_ALTERADA', $1)`, [yara]);

    // Bruno pediu para cancelar uma fisioterapia (a cliente ainda vai decidir)
    const pedido = brunoFuturo[2];
    if (pedido) {
      await c.query(
        `UPDATE agendamentos SET status = 'CANCELAMENTO_SOLICITADO', cancelamento_solicitado_em = now(),
                motivo_cancelamento = 'Consulta com o ortopedista no mesmo horário' WHERE id = $1`,
        [pedido],
      );
      await notificar('CANCELAMENTO_SOLICITADO', pedido);
    }

    // ------------------------------------------------------------------------
    // 4) Situações da semana: avisos de falta, reposição, aulas avulsas, confirmações
    // ------------------------------------------------------------------------
    const amanha = futuro(1);
    const d2 = futuro(2);
    const d3 = futuro(3);

    // Fernanda (fixa ter/qui 17:10) avisou que não vai na próxima aula e já marcou a reposição em outra turma
    {
      const alvo = futuros.find((u) => u.dow === 2);
      const ag = await aulaFutura(pacs.fernanda, alvo, '17:10');
      if (ag && alvo) {
        await c.query('SELECT fn_avisar_falta_pilates($1, $2, $3)', [ag, pacs.fernanda, 'Viagem a trabalho']);
        const rep = futuros.find((u) => u.dow === 3 && u.dia > alvo.dia) ?? futuros.find((u) => u.dow === 3);
        const r = await agendar(pacs.fernanda, rep, 'PILATES', '09:00', { reposicao_de: ag });
        await notificar('REPOSICAO_MARCADA', r);
      }
    }
    // Kleber avisou falta: reposição liberada, ainda não usada
    {
      const alvo = futuros.find((u) => u.dow === 4);
      const ag = await aulaFutura(pacs.kleber, alvo, '16:00');
      if (ag) await c.query('SELECT fn_avisar_falta_pilates($1, $2, $3)', [ag, pacs.kleber, 'Consulta médica no mesmo horário']);
    }
    // Carla: avulsas futuras; uma delas ela avisou que não vai (reposição já marcada)
    {
      const ds = futuros.filter((u) => u.dow === 1 || u.dow === 4).slice(0, 4);
      let i = 0;
      for (const d of ds) {
        const ag = await agendar(carla, d, 'PILATES', d.dow === 1 ? '17:10' : '18:10');
        if (i++ === 1 && ag) {
          await c.query('SELECT fn_avisar_falta_pilates($1, $2, $3)', [ag, carla, 'Compromisso de família']);
          const rep = futuros.find((u) => u.dow === 3 && u.dia > d.dia);
          await notificar('REPOSICAO_MARCADA', await agendar(carla, rep, 'PILATES', '08:00', { reposicao_de: ag }));
        }
      }
    }
    // Diego: duas aulas avulsas de pilates marcadas
    for (const d of futuros.filter((u) => u.dow === 2).slice(0, 2)) {
      await agendar(diego, d, 'PILATES', '08:00');
    }

    // Presença confirmada pelos pacientes nas aulas dos próximos dias
    await c.query(
      `UPDATE agendamentos a SET presenca_confirmada_em = now() - interval '2 hours'
         FROM horarios h
        WHERE h.id = a.horario_id AND a.status = 'AGENDADO' AND h.modalidade <> 'AVALIACAO'
          AND h.inicio > now() AND h.inicio < now() + interval '40 hours'
          AND a.paciente_id IN (SELECT id FROM pacientes WHERE nome_completo ~ '^(Ana|Beatriz|Carlos|Eduardo|Igor|Bruno|Diego)')`,
    );
    await c.query(`SELECT fn_notificar_agendamento('PRESENCA_CONFIRMADA', a.id)
                     FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
                    WHERE a.presenca_confirmada_em IS NOT NULL AND h.inicio > now()
                      AND a.paciente_id IN (SELECT p.id FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1)
                    LIMIT 4`, [DOMINIO]);

    // ------------------------------------------------------------------------
    // 5) Novos pacientes em andamento
    // ------------------------------------------------------------------------
    // Elisa: aula experimental paga (Pix) e avaliação marcada
    const elisa = await paciente('Elisa Freitas', 'elisa', '2000-09-18', '81999030001', 'Rua Nova, 300 - Cohab');
    {
      const exp = await agendar(elisa, amanha, 'PILATES', amanha?.dow === 2 ? '18:10' : amanha?.dow === 3 ? '09:00' : '17:10', { experimental: true });
      await notificar('AULA_EXPERIMENTAL_MARCADA', exp);
      if (exp) await c.query(`SELECT fn_registrar_pagamento_experimental($1, 'PIX', $2)`, [exp, adminId]);
      const av = await agendar(elisa, d2, 'AVALIACAO', horaAval[d2?.dow ?? 1], { avaliacao_para: 'PILATES' });
      await notificar('AGENDAMENTO_CRIADO', av);
    }
    // Rafael: avaliação de pilates marcada para amanhã
    const rafael = await paciente('Rafael Moura', 'rafael', '1996-12-01', '81999030002', 'Rua Rosa e Silva, 410 - Aflitos');
    await notificar('AGENDAMENTO_CRIADO', await agendar(rafael, amanha, 'AVALIACAO', horaAval[amanha?.dow ?? 2], { avaliacao_para: 'PILATES' }));
    // Wesley: aula experimental marcada, pagamento ainda pendente
    const wesley = await paciente('Wesley Andrade', 'wesley', '1994-03-12', '81999030003', 'Av. Norte, 3000 - Encruzilhada');
    {
      const dq = futuros.find((u) => u.dow === 4);
      await notificar('AULA_EXPERIMENTAL_MARCADA', await agendar(wesley, dq, 'PILATES', '09:30', { experimental: true }));
    }
    // Fábio: faltou duas vezes à aula experimental (gera o alerta para a cliente)
    const fabio = await paciente('Fábio Nunes', 'fabio', '1990-01-03', '81999030004', 'Travessa Sete, 12 - São Pedro');
    {
      await falta(await agendar(fabio, diaDe(-2, 1), 'PILATES', '18:10', { experimental: true }));
      await falta(await agendar(fabio, diaDe(-1, 2), 'PILATES', '18:10', { experimental: true }));
    }
    // Quésia: cadastrou-se hoje, ainda sem avaliação
    await paciente('Quésia Andrade', 'quesia', '1999-06-30', '81999030005', 'Rua dos Navegantes, 25 - Pina');
    // Tiago: cadastro de 2 semanas atrás que nunca marcou avaliação
    await paciente('Tiago Nobre', 'tiago', '1982-10-10', '81999030006', 'Rua Joaquim Nabuco, 199 - Graças');

    // Gabriela já pediu nova avaliação à clínica (aparece como pendência para a cliente)
    await c.query('SELECT fn_pedir_nova_avaliacao($1)', [gabriela]);

    // ------------------------------------------------------------------------
    // 6) Capacidade: a cliente reduziu uma turma
    // ------------------------------------------------------------------------
    const turmaReduzida = await horarioEm(d3 ?? futuro(3), 'PILATES', (d3?.dow === 1) ? '18:10' : (d3?.dow === 2) ? '18:10' : (d3?.dow === 4) ? '18:10' : '09:00');
    if (turmaReduzida) {
      await c.query(
        `UPDATE horarios SET capacidade = GREATEST(4,
           (SELECT COUNT(*) FROM agendamentos WHERE horario_id = $1 AND status <> 'CANCELADO')) WHERE id = $1`,
        [turmaReduzida],
      );
    }

    // ------------------------------------------------------------------------
    // 7) Datas realistas no histórico
    // ------------------------------------------------------------------------
    await c.query(
      `UPDATE agendamentos a SET criado_em = h.inicio - interval '4 days'
         FROM horarios h WHERE h.id = a.horario_id AND h.inicio < now()
          AND a.paciente_id IN (SELECT p.id FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1)`, [DOMINIO]);
    await c.query(
      `UPDATE agendamentos a SET presenca_registrada_em = h.inicio + interval '1 hour'
         FROM horarios h WHERE h.id = a.horario_id AND a.presenca_registrada_em IS NOT NULL AND h.inicio < now()
          AND a.paciente_id IN (SELECT p.id FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1)`, [DOMINIO]);
    await c.query(
      `UPDATE registros_atendimento r SET criado_em = h.inicio + interval '1 hour', atualizado_em = h.inicio + interval '1 hour'
         FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = r.agendamento_id AND h.inicio < now()`);
    await c.query(
      `UPDATE avaliacoes v SET avaliado_em = h.inicio + interval '1 hour'
         FROM agendamentos a JOIN horarios h ON h.id = a.horario_id WHERE a.id = v.agendamento_id AND h.inicio < now()`);
    // cadastro dos pacientes sem avaliação
    await c.query(
      `UPDATE usuarios u SET criado_em = p.criado_em FROM pacientes p WHERE p.usuario_id = u.id AND u.email LIKE '%' || $1`, [DOMINIO]);
    await c.query(`UPDATE pacientes SET criado_em = now() - interval '14 days' WHERE nome_completo = 'Tiago Nobre'`);
    await c.query(`UPDATE usuarios SET criado_em = now() - interval '14 days' WHERE email = 'tiago' || $1`, [DOMINIO]);
    // notificações antigas: data do fato e já lidas
    await c.query(
      `UPDATE notificacoes n SET criada_em = CASE
              WHEN n.tipo = 'AVALIACAO_CONCLUIDA' THEN h.inicio + interval '1 hour'
              ELSE LEAST(n.criada_em, h.inicio - interval '3 days') END
         FROM agendamentos a JOIN horarios h ON h.id = a.horario_id
        WHERE a.id = n.agendamento_id AND h.inicio < now()`);
    await c.query(
      `UPDATE notificacoes n SET criada_em = p.criado_em + interval '5 minutes' FROM pacientes p
        WHERE p.id = n.paciente_id AND n.tipo = 'CADASTRO_NOVO' AND p.criado_em < now() - interval '2 days'`);
    // horário fixo definido: logo depois da avaliação, já visto pela cliente
    await c.query(
      `UPDATE notificacoes n SET criada_em = v.avaliado_em + interval '1 day'
         FROM (SELECT paciente_id, max(avaliado_em) AS avaliado_em FROM avaliacoes GROUP BY paciente_id) v
        WHERE v.paciente_id = n.paciente_id AND n.tipo = 'HORARIO_FIXO_DEFINIDO'`);
    await c.query(`UPDATE notificacoes SET criada_em = now() - interval '25 days' WHERE tipo = 'SITUACAO_ALTERADA'`);
    await c.query(`UPDATE mudancas_situacao SET alterado_em = now() - interval '25 days' WHERE paciente_id IN (SELECT id FROM pacientes WHERE nome_completo IN ('Henrique Alves', 'Yara Fonseca'))`).catch(() => null);
    await c.query(`UPDATE notificacoes SET lida_em = criada_em + interval '2 hours' WHERE criada_em < now() - interval '3 days' AND lida_em IS NULL`);

    await c.query('COMMIT');

    const cont = (await pool.query(
      `SELECT (SELECT COUNT(*) FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1)::int AS pacientes,
              (SELECT COUNT(*) FROM agendamentos a JOIN pacientes p ON p.id = a.paciente_id JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1)::int AS agendamentos,
              (SELECT COUNT(*) FROM registros_atendimento r JOIN pacientes p ON p.id = r.paciente_id JOIN usuarios u ON u.id = p.usuario_id WHERE u.email LIKE '%' || $1)::int AS registros`,
      [DOMINIO])).rows[0];

    console.log('Dados de demonstração criados!');
    console.log(`- ${cont.pacientes} pacientes · ${cont.agendamentos} agendamentos · ${cont.registros} registros de atendimento`);
    console.log(`- ${pilates.rows[0].n} aulas de pilates abertas (9 semanas atrás até 6 semanas à frente)`);
    if (pulados) {
      console.log(`- ${pulados} agendamento(s) pulado(s) (regra do banco ou horário inexistente):`);
      for (const m of motivosPulo.slice(0, 12)) console.log('    · ' + m);
    }
    console.log('');
    console.log(`Cliente (administradora): ${adminEmail}${adminCriado ? `  senha: ${SENHA}` : '  (a senha que você já definiu)'}`);
    console.log(`Pacientes: <nome>${DOMINIO}  senha: ${SENHA}`);
    console.log('  ana (pilates fixo ter/qui) · bruno (fisio + pilates, pedido de cancelamento pendente) · diego (fisio + pilates)');
    console.log('  fernanda (avisou falta, repôs aula) · kleber (reposição liberada) · carla (aulas avulsas)');
    console.log('  elisa (experimental paga + avaliação) · rafael (avaliação amanhã) · wesley (experimental a pagar)');
    console.log('  fabio (2 faltas na experimental) · gabriela (não liberada, pediu nova avaliação) · ursula (não liberada)');
    console.log('  sabrina (liberada, sem turma) · henrique (alta) · yara (interrompido) · quesia/tiago (sem avaliação)');
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
