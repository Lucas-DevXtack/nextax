import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from './env.js';

export class AppError extends Error {
  constructor(public message: string, public status = 400) {
    super(message);
    this.name = 'AppError';
  }
}

function zodMessage(error: ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`)
    .join('; ');
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, message: err.message });
  }

  if (err instanceof ZodError) {
    const message = zodMessage(err);
    return res.status(400).json({ error: message, message });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Registro duplicado', message: 'Registro duplicado' });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Registro não encontrado', message: 'Registro não encontrado' });
    }
  }

  const message = isProduction ? 'Erro interno' : err instanceof Error ? err.message : 'Erro interno';
  console.error('[api:error]', err);

  return res.status(500).json({ error: message, message });
}
