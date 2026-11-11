import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { pool } from './db';
import { ErroHttp, tratarErros } from './erros';
import { agendamentosRoutes } from './routes/agendamentos';
import { alertasRoutes } from './routes/alertas';
import { authRoutes } from './routes/auth';
import { feriadosRoutes } from './routes/feriados';
import { horariosRoutes } from './routes/horarios';
import { notificacoesRoutes } from './routes/notificacoes';
import { pacientesRoutes } from './routes/pacientes';
import { pilatesRoutes } from './routes/pilates';
import { registrosRoutes } from './routes/registros';

export const app = express();

app.use(cors());
app.use(express.json());

// Página simples para testar a API no navegador: http://localhost:3333/teste
app.use('/teste', express.static(path.join(__dirname, '..', 'public')));

/** Página inicial: confirma que a API está no ar e aponta as rotas principais. */
app.get('/', (_req, res) => {
  res.json({
    api: 'API da clínica de fisioterapia e pilates',
    status: 'no ar',
    pagina_de_testes: '/teste',
    saude: '/saude',
    rotas: ['/auth', '/pacientes', '/horarios', '/agendamentos', '/pilates', '/feriados', '/registros', '/notificacoes', '/alertas'],
    documentacao: 'Veja o README.md da pasta clinica-api',
  });
});

/** Verifica se a API e o banco estão no ar. */
app.get('/saude', async (_req, res) => {
  const { rows } = await pool.query('SELECT now() AS agora');
  res.json({ api: 'ok', banco: 'ok', agora: rows[0].agora });
});

app.use('/auth', authRoutes);
app.use('/pacientes', pacientesRoutes);
app.use('/horarios', horariosRoutes);
app.use('/agendamentos', agendamentosRoutes);
app.use('/registros', registrosRoutes);
app.use('/alertas', alertasRoutes);
app.use('/notificacoes', notificacoesRoutes);
app.use('/pilates', pilatesRoutes);
app.use('/feriados', feriadosRoutes);

app.use(() => {
  throw new ErroHttp(404, 'Rota não encontrada');
});

app.use(tratarErros);
