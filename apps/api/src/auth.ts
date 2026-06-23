import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from './db.js';
import { env, isProduction } from './env.js';
import { AppError } from './errors.js';

export type RoleCode = 'OWNER' | 'ADMIN' | 'FINANCE' | 'ACCOUNTANT' | 'READER';
export type AuthUser = { id: string; tenantId: string; email: string; role: RoleCode };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const cookieName = 'nextax_refresh';
const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
const FIFTEEN_MINUTES = 1000 * 60 * 15;
const TWENTY_FOUR_HOURS = 1000 * 60 * 60 * 24;

export function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function signAccess(user: AuthUser) {
  return jwt.sign(user, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

function assertCanIssueSession(user: { origin: string; emailVerifiedAt: Date | null; deletedAt: Date | null }) {
  if (user.deletedAt) throw new AppError('Usuário inválido', 401);

  if (user.origin === 'NEXTAX' && !user.emailVerifiedAt) {
    throw new AppError('Confirme seu e-mail antes de entrar.', 403);
  }
}

async function sendEmail(input: { to: string; subject: string; html: string; text: string; purpose: string }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.warn(`${input.purpose} solicitado, mas RESEND_API_KEY/EMAIL_FROM não estão configurados.`);
    return { skipped: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError(`Falha ao enviar e-mail. ${detail}`.trim(), 502);
  }

  return response.json().catch(() => ({ ok: true }));
}

export async function sendPasswordResetEmail(input: { to: string; resetUrl: string }) {
  return sendEmail({
    to: input.to,
    subject: 'Redefinição de senha do NexTax',
    purpose: 'Reset de senha',
    html: `
      <p>Você solicitou a redefinição de senha do NexTax.</p>
      <p>Este link expira em 15 minutos:</p>
      <p><a href="${input.resetUrl}">Redefinir senha</a></p>
      <p>Se você não pediu isso, ignore este e-mail.</p>
    `,
    text: `Redefina sua senha do NexTax: ${input.resetUrl}

Este link expira em 15 minutos.`,
  });
}

export async function sendEmailVerificationEmail(input: { to: string; verifyUrl: string }) {
  return sendEmail({
    to: input.to,
    subject: 'Confirme seu e-mail do NexTax',
    purpose: 'Verificação de e-mail',
    html: `
      <p>Confirme seu e-mail para liberar os recursos sensíveis do NexTax.</p>
      <p>Este link expira em 24 horas:</p>
      <p><a href="${input.verifyUrl}">Confirmar e-mail</a></p>
      <p>Se você não criou essa conta, ignore este e-mail.</p>
    `,
    text: `Confirme seu e-mail do NexTax: ${input.verifyUrl}

Este link expira em 24 horas.`,
  });
}


function refreshCookieOptions() {
  // Host-only cookie: evita que qualquer subdomínio de nextax.business receba o refresh token.
  // O path /auth permite que /auth/refresh e /auth/logout leiam/limpem o mesmo cookie.
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    domain: undefined,
    path: '/auth',
    maxAge: THIRTY_DAYS,
  };
}

function clearRefreshCookieOptions() {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  return options;
}

export async function issueSession(res: Response, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('Usuário inválido', 401);
  assertCanIssueSession(user);

  const membership = await prisma.tenantMember.findFirst({
    where: { userId, tenant: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership?.tenantId) throw new AppError('Empresa não encontrada', 403);

  const refresh = crypto.randomBytes(48).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash(refresh),
      expiresAt: new Date(Date.now() + THIRTY_DAYS),
    },
  });

  res.cookie(cookieName, refresh, refreshCookieOptions());

  return {
    accessToken: signAccess({
      id: user.id,
      tenantId: membership.tenantId,
      email: user.email,
      role: membership.role as RoleCode,
    }),
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError('Não autenticado', 401));

  let payload: AuthUser;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AuthUser;
  } catch {
    return next(new AppError('Sessão expirada', 401));
  }

  try {
    const [user, membership] = await Promise.all([
      prisma.user.findUnique({ where: { id: payload.id }, select: { id: true, email: true, origin: true, emailVerifiedAt: true, deletedAt: true } }),
      prisma.tenantMember.findFirst({
        where: { userId: payload.id, tenantId: payload.tenantId },
        select: { role: true, tenant: { select: { deletedAt: true } } },
      }),
    ]);

    if (!user || user.deletedAt || !membership || membership.tenant.deletedAt) {
      return next(new AppError('Sessão inválida ou acesso removido', 401));
    }

    if (user.origin === 'NEXTAX' && !user.emailVerifiedAt) {
      return next(new AppError('Confirme seu e-mail antes de continuar.', 403));
    }

    req.user = {
      id: user.id,
      tenantId: payload.tenantId,
      email: user.email,
      role: membership.role as RoleCode,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...allowedRoles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Não autenticado', 401));
    if (!allowedRoles.includes(req.user.role)) return next(new AppError('Permissão insuficiente', 403));
    return next();
  };
}

export async function signup(name: string, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.$transaction(async (tx: any) => {
    const user = await tx.user.create({ data: { name: cleanName, email: normalizedEmail, passwordHash } });
    const tenant = await tx.tenant.create({
      data: { name: `Empresa de ${cleanName}`, ownerId: user.id, taxProfile: 'UNKNOWN' },
    });

    await tx.tenantMember.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' } });
    await tx.fiscalProfile.create({ data: { tenantId: tenant.id } });
    await tx.auditLog.create({
      data: { tenantId: tenant.id, userId: user.id, action: 'SIGNUP', entity: 'User', entityId: user.id },
    });

    return user;
  });
}

export async function upsertNexCoreUser(input: {
  name: string;
  email: string;
  tenantName?: string;
  nexcoreTenantId?: string;
  plan?: 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';
  planExpiresAt?: Date | null;
  enabledIntegrations?: Array<'NEXFINANCE' | 'NEXSTOCK' | 'NEXCRM'>;
  integrationAddons?: Array<'NEXFINANCE' | 'NEXSTOCK' | 'NEXCRM'>;
  membershipRole?: RoleCode;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const name = input.name?.trim() || normalizedEmail.split('@')[0];
  const membershipRole = input.membershipRole ?? 'OWNER';

  return prisma.$transaction(async (tx: any) => {
    let user = await tx.user.findUnique({ where: { email: normalizedEmail }, include: { tenants: true } });
    const tenantAccessData: Record<string, unknown> = {};

    if (input.plan) {
      tenantAccessData.plan = input.plan;
      tenantAccessData.planExpiresAt = input.plan === 'FREE' ? null : input.planExpiresAt ?? null;
    }
    if (input.enabledIntegrations) tenantAccessData.enabledIntegrations = input.enabledIntegrations;
    if (input.integrationAddons) tenantAccessData.integrationAddons = input.integrationAddons;

    if (!user) {
      const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(36).toString('hex'), 12);
      user = await tx.user.create({
        data: { name, email: normalizedEmail, passwordHash: unusablePasswordHash, origin: 'NEXCORE' as const, emailVerifiedAt: new Date() },
        include: { tenants: true },
      });
    } else {
      const userData: Record<string, unknown> = {};

      if (user.origin !== 'NEXCORE') userData.origin = 'NEXCORE' as const;
      if (!user.emailVerifiedAt) userData.emailVerifiedAt = new Date();
      if (user.name !== name && name) userData.name = name;

      if (Object.keys(userData).length) {
        user = await tx.user.update({
          where: { id: user.id },
          data: userData,
          include: { tenants: true },
        });
      }
    }

    if (!user.tenants.length) {
      const tenant = await tx.tenant.create({
        data: {
          ...(input.nexcoreTenantId ? { id: input.nexcoreTenantId } : {}),
          name: input.tenantName || `Empresa de ${name}`,
          ownerId: user.id,
          taxProfile: 'UNKNOWN',
          origin: 'NEXCORE' as const,
          ...tenantAccessData,
        },
      });
      await tx.tenantMember.create({ data: { userId: user.id, tenantId: tenant.id, role: membershipRole } });
      await tx.fiscalProfile.create({ data: { tenantId: tenant.id } });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, userId: user.id, action: 'SSO_SIGNUP', entity: 'User', entityId: user.id },
      });
    } else {
      if (user.tenants[0]?.tenantId) {
        await tx.tenant.update({
          where: { id: user.tenants[0].tenantId },
          data: { origin: 'NEXCORE' as const, ...tenantAccessData },
        });

        await tx.tenantMember.updateMany({
          where: { userId: user.id, tenantId: user.tenants[0].tenantId },
          data: { role: membershipRole },
        });
      }
    }

    return tx.user.findUniqueOrThrow({ where: { id: user.id } });
  });
}

export async function rotateRefresh(req: Request, res: Response) {
  const token = req.cookies?.[cookieName];
  if (!token) throw new AppError('Refresh ausente', 401);

  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new AppError('Refresh inválido', 401);
  }

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  return issueSession(res, record.userId);
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[cookieName];
  if (token) {
    await prisma.refreshToken.updateMany({ where: { tokenHash: hash(token) }, data: { revokedAt: new Date() } });
  }

  res.clearCookie(cookieName, clearRefreshCookieOptions());
}

export async function createPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const token = crypto.randomBytes(40).toString('hex');

  const baseUrl = env.RESET_PASSWORD_URL || `${env.WEB_ORIGIN.replace(/\/$/, '')}/reset-password`;
  const resetUrl = `${baseUrl}?token=${token}`;

  if (user && !user.deletedAt) {
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + FIFTEEN_MINUTES),
      },
    });

    await sendPasswordResetEmail({ to: user.email, resetUrl });
  }

  return resetUrl;
}

export async function createEmailVerification(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true, deletedAt: true } });
  if (!user || user.deletedAt) throw new AppError('Usuário inválido', 404);
  if (user.emailVerifiedAt) return { alreadyVerified: true, verifyUrl: null as string | null };

  const token = crypto.randomBytes(40).toString('hex');
  const verifyUrl = `${env.WEB_ORIGIN.replace(/\/$/, '')}/verify-email?token=${token}`;

  await prisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + TWENTY_FOUR_HOURS),
    },
  });

  await sendEmailVerificationEmail({ to: user.email, verifyUrl });
  return { alreadyVerified: false, verifyUrl };
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError('Token de verificação inválido ou expirado', 400);
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function changeOwnPassword(input: { userId: string; currentPassword: string; newPassword: string }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.deletedAt) throw new AppError('Usuário inválido', 401);

  const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!ok) throw new AppError('Senha atual inválida', 401);

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: input.userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function resetPassword(token: string, password: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash(token) } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError('Token inválido ou expirado', 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
