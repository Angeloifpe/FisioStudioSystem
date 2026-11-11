import { app } from './app';
import { config } from './config';
import { pool } from './db';

async function iniciar() {
  try {
    await pool.query('SELECT 1');
  } catch (erro) {
    console.error('Não consegui conectar ao PostgreSQL. Confira DATABASE_URL no arquivo .env.');
    console.error((erro as Error).message);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`API da clínica rodando em http://localhost:${config.port}`);
  });
}

iniciar();
