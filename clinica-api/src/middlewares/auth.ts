import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ErroHttp } from '../erros';

export type Papel = 'ADMIN' | 'PACIENTE';

export interface Usuario {
  id: string;
  papel: Papel;
  pacienteId: string | null;
  /** Entrou com senha temporária: só pode trocar a senha e ver os próprios dados. */
  trocarSenha?: boolean;
}

/** Rotas liberadas enquanto o usuário ainda está com a senha temporária. */
const rotasComSenhaTemporaria = ['/auth/trocar-senha', '/auth/me'];

declare global {
  namespace Express {
    interface Request {
      usuario?: Usuario;
    }
  }
}

export function gerarToken(usuario: Usuario): string {
  return jwt.sign(
    { papel: usuario.papel, pacienteId: usuario.pacienteId, ...(usuario.trocarSenha ? { trocarSenha: true } : {}) },
    config.jwtSecret,
    { subject: usuario.id, expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] },
  );
}

/** Exige um token válido no cabeçalho Authorization: Bearer <token>. */
export function autenticar(req: Request, _res: Response, next: NextFunction) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho?.startsWith('Bearer ')) {
    throw new ErroHttp(401, 'Faça login para continuar');
  }
  let dados: jwt.JwtPayload;
  try {
    dados = jwt.verify(cabecalho.slice(7), config.jwtSecret) as jwt.JwtPayload;
  } catch {
    throw new ErroHttp(401, 'Sessão expirada ou inválida; faça login de novo');
  }
  req.usuario = {
    id: dados.sub as string,
    papel: dados.papel as Papel,
    pacienteId: (dados.pacienteId as string | null) ?? null,
    trocarSenha: dados.trocarSenha === true,
  };
  if (req.usuario.trocarSenha && !rotasComSenhaTemporaria.includes(req.baseUrl + req.path)) {
    throw new ErroHttp(403, 'Você entrou com uma senha temporária; crie uma senha nova para continuar');
  }
  next();
}

/** Libera a rota só para os papéis informados. */
export function somente(...papeis: Papel[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario || !papeis.includes(req.usuario.papel)) {
      throw new ErroHttp(403, 'Você não tem permissão para esta ação');
    }
    next();
  };
}

export function usuarioDe(req: Request): Usuario {
  if (!req.usuario) throw new ErroHttp(401, 'Faça login para continuar');
  return req.usuario;
}

export function pacienteDe(req: Request): string {
  const u = usuarioDe(req);
  if (!u.pacienteId) throw new ErroHttp(403, 'Ação disponível só para pacientes');
  return u.pacienteId;
}
