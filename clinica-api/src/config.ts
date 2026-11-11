import 'dotenv/config';

function obrigatorio(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} não definida. Copie .env.example para .env e preencha.`);
  }
  return valor;
}

export const config = {
  databaseUrl: obrigatorio('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3333),
  jwtSecret: obrigatorio('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  timezone: process.env.TIMEZONE ?? 'America/Sao_Paulo',
};
