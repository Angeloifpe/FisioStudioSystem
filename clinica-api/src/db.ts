import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// DATE vem como texto 'AAAA-MM-DD' (sem conversão de fuso)
types.setTypeParser(1082, (valor) => valor);
// BIGINT (ex.: COUNT) vem como número
types.setTypeParser(20, (valor) => Number(valor));

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const resultado = await pool.query(sql, params);
  return resultado.rows as T[];
}

export async function queryOne<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const linhas = await query<T>(sql, params);
  return linhas[0] ?? null;
}

/** Executa várias operações numa única transação. */
export async function transacao<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}
