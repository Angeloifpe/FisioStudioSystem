/**
 * Cria (ou atualiza a senha de) a conta da cliente, que administra a clínica.
 *
 *   npm run criar-admin -- email@clinica.com senha
 */
import bcrypt from 'bcryptjs';
import { pool } from '../db';

async function main() {
  const [email, senha] = process.argv.slice(2);
  if (!email || !senha) {
    console.error('Uso: npm run criar-admin -- email@clinica.com senha');
    process.exit(1);
  }
  if (senha.length < 6) {
    console.error('A senha precisa ter pelo menos 6 caracteres.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(senha, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (email, senha_hash, papel)
     VALUES (lower($1), $2, 'ADMIN')
     ON CONFLICT (email) DO UPDATE
       SET senha_hash = EXCLUDED.senha_hash
     WHERE usuarios.papel = 'ADMIN'
     RETURNING id`,
    [email, hash],
  );

  if (rows.length === 0) {
    console.error('Este e-mail já pertence a um paciente. Use outro e-mail para a cliente.');
    process.exit(1);
  }

  console.log(`Conta da cliente pronta: ${email.toLowerCase()}`);
  await pool.end();
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
