import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from './db.js';
import { env } from './env.js';
import { AppError } from './errors.js';
import { createSignedDocumentUrl, decodeBase64File, deleteFiscalDocument, normalizeDocumentMimeType, uploadFiscalDocument } from './storage.js';
import {
  changeOwnPassword,
  createEmailVerification,
  createPasswordReset,
  issueSession,
  signAccess,
  logout,
  requireAuth,
  requireRole,
  resetPassword,
  rotateRefresh,
  signup,
  upsertNexCoreUser,
  verifyEmail,
} from './auth.js';

const r = Router();

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

const password = z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/);
const disclaimer = 'Esta simulação é apenas informativa e não substitui análise de contador ou profissional habilitado.';

const paymentMethods = ['PIX', 'CASH', 'CARD', 'BOLETO', 'TRANSFER', 'OTHER'] as const;
const revenueCategories = ['SERVICE', 'PRODUCT', 'RECURRING', 'OCCASIONAL', 'OTHER'] as const;
const expenseCategories = [
  'RENT',
  'ENERGY',
  'INTERNET',
  'ACCOUNTANT',
  'SUPPLIER',
  'TRANSPORT',
  'MARKETING',
  'SOFTWARE',
  'CARD_MACHINE',
  'WORK_MATERIAL',
  'MAINTENANCE',
  'FOOD',
  'OTHER',
] as const;
const obligationTypes = ['DAS_MEI', 'DAS_SIMPLES', 'MUNICIPAL_GUIDE', 'CUSTOM_TAX', 'OTHER'] as const;
const obligationStatuses = ['PENDING', 'PAID', 'OVERDUE', 'IGNORED', 'REVIEWING'] as const;
const documentTypes = [
  'DAS',
  'INVOICE',
  'RECEIPT',
  'STATEMENT',
  'CONTRACT',
  'COMPANY_DOCUMENT',
  'PERSONAL_DOCUMENT',
  'REPORT',
  'OTHER',
] as const;
const documentStatuses = ['PENDING', 'REVIEWED', 'SENT_TO_ACCOUNTANT', 'APPROVED', 'REJECTED', 'NEEDS_FIX'] as const;
const checklistStatuses = ['PENDING', 'DONE', 'SKIPPED'] as const;
const taxRegimes = ['MEI', 'SIMPLES_NACIONAL', 'AUTONOMO', 'UNKNOWN', 'OTHER'] as const;
const businessTypes = ['SERVICE', 'COMMERCE', 'INDUSTRY', 'SERVICE_AND_COMMERCE', 'OTHER'] as const;

const optionalText = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.string().trim().optional());
const positiveMoney = z.coerce.number().finite().positive();
const optionalMoney = z.preprocess((value) => (value === '' || value === null ? undefined : value), z.coerce.number().finite().nonnegative().optional());


type PlanCode = 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';
type PaidPlanCode = Exclude<PlanCode, 'FREE'>;
type BillingItemType = 'PLAN' | 'INTEGRATION_ADDON';
type BillingStatus = 'PENDING' | 'APPROVED' | 'AUTHORIZED' | 'IN_PROCESS' | 'REJECTED' | 'CANCELLED' | 'REFUNDED' | 'CHARGED_BACK' | 'ERROR';
type IntegrationCode = 'NEXFINANCE' | 'NEXSTOCK' | 'NEXCRM';
type PageKey = 'dashboard' | 'revenues' | 'expenses' | 'obligations' | 'documents' | 'checklist' | 'simulator' | 'reports' | 'settings';
type ReportAccess = false | 'monthly_summary' | 'pdf_excel' | 'advanced_multi_company';
type ChecklistAccess = 'view' | 'manual' | 'auto' | 'auto_with_responsible';
type SimulatorAccess = 'basic' | 'mei_full' | 'mei_vs_simples' | 'advanced';

type PlanLimit = {
  label: string;
  revenuePerMonth: number | null;
  expensePerMonth: number | null;
  documents: number;
  reports: ReportAccess;
  das: boolean;
  checklist: ChecklistAccess;
  simulator: SimulatorAccess;
  accountantAccess: boolean;
  multiCompany: boolean;
  pages: Record<PageKey, boolean>;
  integrations: IntegrationCode[];
};

const PLAN_LABELS: Record<PlanCode, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  BUSINESS: 'Business',
};

const PLAN_ORDER: PlanCode[] = ['FREE', 'STARTER', 'PRO', 'BUSINESS'];

const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: 'Dashboard',
  revenues: 'Faturamento',
  expenses: 'Despesas',
  obligations: 'DAS e obrigações',
  documents: 'Documentos',
  checklist: 'Checklist',
  simulator: 'Simulador',
  reports: 'Relatórios',
  settings: 'Configurações',
};

const REQUIRED_PLAN_BY_PAGE: Record<PageKey, PlanCode> = {
  dashboard: 'FREE',
  revenues: 'FREE',
  expenses: 'FREE',
  obligations: 'STARTER',
  documents: 'STARTER',
  checklist: 'FREE',
  simulator: 'FREE',
  reports: 'STARTER',
  settings: 'FREE',
};

const NEXTAX_PLAN_LIMITS: Record<PlanCode, PlanLimit> = {
  FREE: {
    label: PLAN_LABELS.FREE,
    revenuePerMonth: 20,
    expensePerMonth: 10,
    documents: 0,
    reports: false,
    das: false,
    checklist: 'view',
    simulator: 'basic',
    accountantAccess: false,
    multiCompany: false,
    pages: {
      dashboard: true,
      revenues: true,
      expenses: true,
      obligations: false,
      documents: false,
      checklist: true,
      simulator: true,
      reports: false,
      settings: true,
    },
    integrations: [],
  },
  STARTER: {
    label: PLAN_LABELS.STARTER,
    revenuePerMonth: 300,
    expensePerMonth: 300,
    documents: 50,
    reports: 'monthly_summary',
    das: true,
    checklist: 'manual',
    simulator: 'mei_full',
    accountantAccess: false,
    multiCompany: false,
    pages: {
      dashboard: true,
      revenues: true,
      expenses: true,
      obligations: true,
      documents: true,
      checklist: true,
      simulator: true,
      reports: true,
      settings: true,
    },
    integrations: ['NEXFINANCE'],
  },
  PRO: {
    label: PLAN_LABELS.PRO,
    revenuePerMonth: null,
    expensePerMonth: null,
    documents: 500,
    reports: 'pdf_excel',
    das: true,
    checklist: 'auto',
    simulator: 'mei_vs_simples',
    accountantAccess: true,
    multiCompany: false,
    pages: {
      dashboard: true,
      revenues: true,
      expenses: true,
      obligations: true,
      documents: true,
      checklist: true,
      simulator: true,
      reports: true,
      settings: true,
    },
    integrations: ['NEXFINANCE', 'NEXSTOCK'],
  },
  BUSINESS: {
    label: PLAN_LABELS.BUSINESS,
    revenuePerMonth: null,
    expensePerMonth: null,
    documents: 5000,
    reports: 'advanced_multi_company',
    das: true,
    checklist: 'auto_with_responsible',
    simulator: 'advanced',
    accountantAccess: true,
    multiCompany: true,
    pages: {
      dashboard: true,
      revenues: true,
      expenses: true,
      obligations: true,
      documents: true,
      checklist: true,
      simulator: true,
      reports: true,
      settings: true,
    },
    integrations: ['NEXFINANCE', 'NEXSTOCK', 'NEXCRM'],
  },
};

const PLAN_PRICES: Record<PaidPlanCode, number> = {
  STARTER: env.NEXTAX_PRICE_STARTER,
  PRO: env.NEXTAX_PRICE_PRO,
  BUSINESS: env.NEXTAX_PRICE_BUSINESS,
};

const INTEGRATION_ADDON_PRICES: Record<IntegrationCode, number> = {
  NEXFINANCE: env.NEXTAX_ADDON_NEXFINANCE_PRICE,
  NEXSTOCK: env.NEXTAX_ADDON_NEXSTOCK_PRICE,
  NEXCRM: env.NEXTAX_ADDON_NEXCRM_PRICE,
};

const BILLING_STATUS_BY_MERCADO_PAGO: Record<string, BillingStatus> = {
  pending: 'PENDING',
  in_process: 'IN_PROCESS',
  in_mediation: 'IN_PROCESS',
  authorized: 'AUTHORIZED',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  charged_back: 'CHARGED_BACK',
};

function integrationCatalog() {
  return {
    NEXFINANCE: {
      key: 'NEXFINANCE' as const,
      label: 'NexFinance',
      description: 'Receitas, despesas e fluxo financeiro conectados à rotina fiscal.',
      url: env.NEXFINANCE_APP_URL,
    },
    NEXSTOCK: {
      key: 'NEXSTOCK' as const,
      label: 'NexStock',
      description: 'Vendas, estoque e movimentações que ajudam no fechamento fiscal.',
      url: env.NEXSTOCK_APP_URL,
    },
    NEXCRM: {
      key: 'NEXCRM' as const,
      label: 'NexCRM',
      description: 'Clientes e histórico comercial integrados ao ecossistema.',
      url: env.NEXCRM_APP_URL,
    },
  };
}

function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && value in NEXTAX_PLAN_LIMITS;
}

function normalizePlan(value: unknown): PlanCode {
  return isPlanCode(value) ? value : 'FREE';
}

function uniqueIntegrations(values: unknown[]): IntegrationCode[] {
  const allowed = new Set<IntegrationCode>(['NEXFINANCE', 'NEXSTOCK', 'NEXCRM']);
  const result: IntegrationCode[] = [];

  for (const value of values.flat()) {
    if (typeof value === 'string' && allowed.has(value as IntegrationCode) && !result.includes(value as IntegrationCode)) {
      result.push(value as IntegrationCode);
    }
  }

  return result;
}

function optionalIntegrationsFrom(...values: unknown[]): IntegrationCode[] | undefined {
  if (!values.some((value) => Array.isArray(value))) return undefined;
  return uniqueIntegrations(values);
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === '') return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function planExpirationFor(plan: PlanCode | undefined, value: unknown): Date | null | undefined {
  if (!plan) return undefined;
  if (plan === 'FREE') return null;
  return optionalDate(value) ?? null;
}

function planAccessData(input: { plan?: PlanCode; expiresAt?: unknown; enabledIntegrations?: IntegrationCode[]; integrationAddons?: IntegrationCode[] }) {
  const data: Record<string, unknown> = {};

  if (input.plan) {
    data.plan = input.plan;
    data.planExpiresAt = planExpirationFor(input.plan, input.expiresAt);

    if (input.plan === 'FREE') {
      data.enabledIntegrations = [];
      data.integrationAddons = [];
    }
  }

  if (input.plan !== 'FREE' && input.enabledIntegrations) data.enabledIntegrations = input.enabledIntegrations;
  if (input.plan !== 'FREE' && input.integrationAddons) data.integrationAddons = input.integrationAddons;

  return data;
}

function planIndex(plan: PlanCode) {
  return PLAN_ORDER.indexOf(plan);
}

function requiredUpgradePlan(currentPlan: PlanCode, targetPlan: PlanCode) {
  return planIndex(currentPlan) >= planIndex(targetPlan) ? currentPlan : targetPlan;
}

async function getTenantAccess(currentTenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: currentTenantId },
    select: { id: true, plan: true, planExpiresAt: true, origin: true, enabledIntegrations: true, integrationAddons: true },
  });

  if (!tenant) throw new AppError('Empresa não encontrada', 404);

  const now = new Date();
  const storedPlan = normalizePlan(tenant.plan);
  const planExpired = Boolean(tenant.planExpiresAt && tenant.planExpiresAt <= now && storedPlan !== 'FREE');
  const plan = planExpired ? 'FREE' : storedPlan;
  const limits = NEXTAX_PLAN_LIMITS[plan];

  const paidAddons = await prisma.billingCheckout.findMany({
    where: {
      tenantId: currentTenantId,
      itemType: 'INTEGRATION_ADDON',
      status: 'APPROVED',
      periodEnd: { gt: now },
      integrationKey: { not: null },
    },
    select: { integrationKey: true },
  });

  const effectiveIntegrations = uniqueIntegrations([
    limits.integrations,
    tenant.enabledIntegrations,
    tenant.integrationAddons,
    paidAddons.map((addon: any) => addon.integrationKey),
  ]);
  const catalog = integrationCatalog();
  const integrations = effectiveIntegrations.map((key) => ({
    ...catalog[key],
    source: limits.integrations.includes(key) ? 'PLAN' : 'ADDON',
  }));
  const blockedIntegrations = (Object.keys(catalog) as IntegrationCode[])
    .filter((key) => !effectiveIntegrations.includes(key))
    .map((key) => catalog[key]);

  return {
    tenant,
    storedPlan,
    plan,
    planExpired,
    planExpiresAt: tenant.planExpiresAt,
    limits,
    integrations,
    blockedIntegrations,
    pages: limits.pages,
  };
}

function publicAccessPayload(access: Awaited<ReturnType<typeof getTenantAccess>>, userOrigin?: string | null, tenantOrigin?: string | null) {
  const { limits, plan } = access;

  return {
    plan: { code: plan, label: limits.label, rank: planIndex(plan), expiresAt: access.planExpiresAt, expired: access.planExpired },
    canReturnToNexCore: userOrigin === 'NEXCORE' || tenantOrigin === 'NEXCORE',
    pages: limits.pages,
    requiredPlanByPage: REQUIRED_PLAN_BY_PAGE,
    limits: {
      revenuePerMonth: limits.revenuePerMonth,
      expensePerMonth: limits.expensePerMonth,
      documents: limits.documents,
    },
    features: {
      reports: limits.reports,
      das: limits.das,
      checklist: limits.checklist,
      simulator: limits.simulator,
      accountantAccess: limits.accountantAccess,
      multiCompany: limits.multiCompany,
    },
    integrations: access.integrations,
    blockedIntegrations: access.blockedIntegrations,
  };
}

async function requirePageAccess(req: { user?: { tenantId?: string } }, page: PageKey) {
  const access = await getTenantAccess(tenantId(req));

  if (!access.pages[page]) {
    const requiredPlan = requiredUpgradePlan(access.plan, REQUIRED_PLAN_BY_PAGE[page]);
    throw new AppError(`${PAGE_LABELS[page]} está disponível a partir do plano ${PLAN_LABELS[requiredPlan]}.`, 403);
  }

  return access;
}

async function requireVerifiedEmail(req: { user?: { id?: string } }) {
  const user = await prisma.user.findUnique({ where: { id: userId(req) }, select: { emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) {
    throw new AppError('Confirme seu e-mail antes de usar recursos sensíveis. Reenvie o link nas configurações.', 403);
  }
}

async function assertMonthlyLimit(req: { user?: { tenantId?: string } }, kind: 'revenues' | 'expenses', date: Date) {
  const access = await requirePageAccess(req, kind);
  const limit = kind === 'revenues' ? access.limits.revenuePerMonth : access.limits.expensePerMonth;

  if (limit === null) return access;

  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const { start, end } = rangeMonth(month, year);
  const count = kind === 'revenues'
    ? await prisma.revenue.count({ where: { tenantId: tenantId(req), receivedAt: { gte: start, lt: end } } })
    : await prisma.expense.count({ where: { tenantId: tenantId(req), paidAt: { gte: start, lt: end } } });

  if (count >= limit) {
    const page = kind === 'revenues' ? 'Faturamento' : 'Despesas';
    const nextPlan = access.plan === 'FREE' ? 'STARTER' : access.plan === 'STARTER' ? 'PRO' : 'BUSINESS';
    throw new AppError(`${page}: limite mensal de ${limit} registros atingido no plano ${PLAN_LABELS[access.plan]}. Faça upgrade para o plano ${PLAN_LABELS[nextPlan]}.`, 403);
  }

  return access;
}

async function assertDocumentLimit(req: { user?: { tenantId?: string } }) {
  const access = await requirePageAccess(req, 'documents');
  const limit = access.limits.documents;

  if (limit <= 0) {
    throw new AppError('Upload de documentos está disponível a partir do plano Starter.', 403);
  }

  const count = await prisma.fiscalDocument.count({ where: { tenantId: tenantId(req), deletedAt: null } });
  if (count >= limit) {
    const nextPlan = access.plan === 'STARTER' ? 'PRO' : 'BUSINESS';
    throw new AppError(`Você atingiu o limite de ${limit} documentos do plano ${PLAN_LABELS[access.plan]}. Faça upgrade para o plano ${PLAN_LABELS[nextPlan]}.`, 403);
  }

  return access;
}

function str(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0].trim();
  throw new AppError('Parâmetro inválido', 400);
}

function tenantId(req: { user?: { tenantId?: string } }): string {
  return str(req.user?.tenantId);
}

function userId(req: { user?: { id?: string } }): string {
  return str(req.user?.id);
}

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(50_000).default(0),
});

async function audit(req: Request, action: string, entity: string, entityId?: string, metadata?: Record<string, unknown>) {
  const userAgentHeader = req.headers?.['user-agent'];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
  const jsonMetadata = metadata === undefined
    ? undefined
    : JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;

  await prisma.auditLog.create({
    data: {
      tenantId: req.user?.tenantId,
      userId: req.user?.id,
      action,
      entity,
      entityId,
      metadata: jsonMetadata,
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 400) : undefined,
    },
  }).catch(() => null);
}

function nexCoreUrl(path: string): string {
  return `${env.NEXCORE_API_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function internalHeader(req: { headers: Record<string, unknown> }) {
  const header = req.headers['x-internal-api-key'];
  return Array.isArray(header) ? header[0] : header;
}

function requireInternalApiKey(req: { headers: Record<string, unknown> }) {
  if (internalHeader(req) !== env.NEXCORE_INTERNAL_API_KEY) {
    throw new AppError('Acesso interno negado', 401);
  }
}

function requireNextaxInternalApiKey(req: { headers: Record<string, unknown> }) {
  if (internalHeader(req) !== env.NEXTAX_INTERNAL_API_KEY) {
    throw new AppError('Acesso interno NexTax negado', 401);
  }
}

function rangeMonth(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildReportCsv(input: { month: number; year: number; summary: Record<string, unknown>; disclaimer: string }) {
  const rows = [
    ['Campo', 'Valor'],
    ['Competência', `${String(input.month).padStart(2, '0')}/${input.year}`],
    ['Receitas', input.summary.revenuesTotal],
    ['Despesas', input.summary.expensesTotal],
    ['Resultado', input.summary.result],
    ['Qtd. receitas', input.summary.revenuesCount],
    ['Qtd. despesas', input.summary.expensesCount],
    ['Qtd. obrigações', input.summary.obligationsCount],
    ['Obrigações pendentes', input.summary.pendingObligationsCount],
    ['Qtd. documentos', input.summary.documentsCount],
    ['Aviso', input.disclaimer],
  ];

  return Buffer.from(`\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\n')}\n`, 'utf8');
}

function pdfText(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(input: { title: string; lines: string[] }) {
  const safeLines = [input.title, '', ...input.lines].slice(0, 42);
  const stream = `BT\n/F1 12 Tf\n50 790 Td\n16 TL\n${safeLines.map((line) => `(${pdfText(line)}) Tj\nT*`).join('')}ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

async function uploadReportExports(input: { tenantId: string; month: number; year: number; summary: Record<string, unknown> }) {
  const competence = `${input.year}-${String(input.month).padStart(2, '0')}`;
  const lines = [
    `Competência: ${String(input.month).padStart(2, '0')}/${input.year}`,
    `Receitas: ${input.summary.revenuesTotal}`,
    `Despesas: ${input.summary.expensesTotal}`,
    `Resultado: ${input.summary.result}`,
    `Receitas lançadas: ${input.summary.revenuesCount}`,
    `Despesas lançadas: ${input.summary.expensesCount}`,
    `Obrigações cadastradas: ${input.summary.obligationsCount}`,
    `Obrigações pendentes: ${input.summary.pendingObligationsCount}`,
    `Documentos: ${input.summary.documentsCount}`,
    '',
    disclaimer,
  ];

  const [pdf, csv] = await Promise.all([
    uploadFiscalDocument({
      tenantId: input.tenantId,
      originalName: `relatorio-nextax-${competence}.pdf`,
      mimeType: 'application/pdf',
      buffer: buildSimplePdf({ title: 'Relatório mensal NexTax', lines }),
    }),
    uploadFiscalDocument({
      tenantId: input.tenantId,
      originalName: `relatorio-nextax-${competence}.csv`,
      mimeType: 'text/csv',
      buffer: buildReportCsv({ month: input.month, year: input.year, summary: input.summary, disclaimer }),
    }),
  ]);

  return { pdfFileKey: pdf.fileKey, csvFileKey: csv.fileKey };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function monthsBack(count: number) {
  const now = new Date();
  const result: { month: number; year: number; label: string }[] = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    result.push({
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
      label: `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`,
    });
  }

  return result;
}


type AutomaticChecklistItem = {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'DONE';
  completedAt: Date | null;
  source: string;
  count?: number;
};

function mostRecentDate(values: Array<Date | null | undefined>) {
  const timestamps = values.filter(Boolean).map((value) => Number(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps));
}

async function buildAutomaticChecklist(currentTenantId: string, month: number, year: number) {
  const { start, end } = rangeMonth(month, year);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const documentMonthWhere = {
    tenantId: currentTenantId,
    deletedAt: null,
    OR: [
      { competenceMonth: month, competenceYear: year },
      { competenceMonth: null, competenceYear: null, createdAt: { gte: start, lt: end } },
    ],
  };

  const [revenues, expenses, documents, obligations, sentDocuments, reports, profile, annualRevenue] = await Promise.all([
    prisma.revenue.aggregate({
      where: { tenantId: currentTenantId, receivedAt: { gte: start, lt: end } },
      _count: { _all: true },
      _max: { updatedAt: true, receivedAt: true },
    }),
    prisma.expense.aggregate({
      where: { tenantId: currentTenantId, paidAt: { gte: start, lt: end } },
      _count: { _all: true },
      _max: { updatedAt: true, paidAt: true },
    }),
    prisma.fiscalDocument.aggregate({
      where: documentMonthWhere,
      _count: { _all: true },
      _max: { updatedAt: true, createdAt: true },
    }),
    prisma.taxObligation.findMany({
      where: { tenantId: currentTenantId, competenceMonth: month, competenceYear: year },
      select: { status: true, paidAt: true, updatedAt: true },
    }),
    prisma.fiscalDocument.aggregate({
      where: { ...documentMonthWhere, status: { in: ['REVIEWED', 'SENT_TO_ACCOUNTANT', 'APPROVED'] } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.fiscalReport.aggregate({
      where: { tenantId: currentTenantId, month, year },
      _count: { _all: true },
      _max: { generatedAt: true },
    }),
    prisma.fiscalProfile.findUnique({ where: { tenantId: currentTenantId } }),
    prisma.revenue.aggregate({
      where: { tenantId: currentTenantId, receivedAt: { gte: yearStart, lt: yearEnd } },
      _sum: { amount: true },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  const openObligations = obligations.filter((item: any) => !['PAID', 'IGNORED'].includes(item.status));
  const obligationsDone = obligations.length > 0 && openObligations.length === 0;
  const limit = Number(profile?.meiAnnualLimit || 81_000);
  const annual = Number(annualRevenue._sum.amount || 0);
  const meiPercent = limit > 0 ? Math.round((annual / limit) * 100) : 0;

  const items: AutomaticChecklistItem[] = [
    {
      id: 'auto-revenues',
      title: 'Registrar receitas do mês',
      description: revenues._count._all ? `${revenues._count._all} receita(s) lançada(s) neste mês.` : 'Lance pelo menos uma receita recebida no mês.',
      status: revenues._count._all ? 'DONE' : 'PENDING',
      completedAt: revenues._count._all ? mostRecentDate([revenues._max.updatedAt, revenues._max.receivedAt]) : null,
      source: 'REVENUES',
      count: revenues._count._all,
    },
    {
      id: 'auto-expenses',
      title: 'Registrar despesas do mês',
      description: expenses._count._all ? `${expenses._count._all} despesa(s) lançada(s) neste mês.` : 'Lance as despesas pagas no mês para o lucro não ficar falso.',
      status: expenses._count._all ? 'DONE' : 'PENDING',
      completedAt: expenses._count._all ? mostRecentDate([expenses._max.updatedAt, expenses._max.paidAt]) : null,
      source: 'EXPENSES',
      count: expenses._count._all,
    },
    {
      id: 'auto-documents',
      title: 'Enviar documentos e comprovantes',
      description: documents._count._all ? `${documents._count._all} documento(s) do mês salvo(s) no storage.` : 'Envie DAS, notas, recibos, extratos ou comprovantes do mês.',
      status: documents._count._all ? 'DONE' : 'PENDING',
      completedAt: documents._count._all ? mostRecentDate([documents._max.updatedAt, documents._max.createdAt]) : null,
      source: 'DOCUMENTS',
      count: documents._count._all,
    },
    {
      id: 'auto-obligations',
      title: 'Quitar ou revisar obrigações fiscais',
      description: obligations.length
        ? obligationsDone
          ? `${obligations.length} obrigação(ões) sem pendência aberta.`
          : `${openObligations.length} obrigação(ões) ainda pendente(s) ou em revisão.`
        : 'Cadastre a obrigação fiscal do mês e marque como paga quando resolver.',
      status: obligationsDone ? 'DONE' : 'PENDING',
      completedAt: obligationsDone ? mostRecentDate(obligations.map((item: any) => item.paidAt ?? item.updatedAt)) : null,
      source: 'TAX_OBLIGATIONS',
      count: obligations.length,
    },
    {
      id: 'auto-mei-limit',
      title: 'Conferir limite anual do MEI',
      description: annualRevenue._count._all
        ? `Faturamento anual registrado: ${meiPercent}% do limite de referência (${annual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`
        : 'Cadastre receitas para o NexTax calcular automaticamente o uso do limite anual.',
      status: annualRevenue._count._all ? 'DONE' : 'PENDING',
      completedAt: annualRevenue._count._all ? annualRevenue._max.updatedAt : null,
      source: 'MEI_LIMIT',
      count: annualRevenue._count._all,
    },
    {
      id: 'auto-report',
      title: 'Gerar relatório mensal',
      description: reports._count._all ? `${reports._count._all} relatório(s) gerado(s) para esta competência.` : 'Gere o relatório mensal após lançar receitas, despesas, obrigações e documentos.',
      status: reports._count._all ? 'DONE' : 'PENDING',
      completedAt: reports._count._all ? reports._max.generatedAt : null,
      source: 'REPORTS',
      count: reports._count._all,
    },
    {
      id: 'auto-accountant',
      title: 'Separar documentos para o contador',
      description: sentDocuments._count._all
        ? `${sentDocuments._count._all} documento(s) revisado(s), aprovado(s) ou marcado(s) para o contador.`
        : 'Mude o status dos documentos para revisado, aprovado ou enviado ao contador quando finalizar a separação.',
      status: sentDocuments._count._all ? 'DONE' : 'PENDING',
      completedAt: sentDocuments._count._all ? sentDocuments._max.updatedAt : null,
      source: 'ACCOUNTANT_PACKAGE',
      count: sentDocuments._count._all,
    },
  ];

  const done = items.filter((item) => item.status === 'DONE').length;
  const status = done === 0 ? 'OPEN' : done === items.length ? 'DONE' : 'PARTIAL';

  return {
    id: `auto-${currentTenantId}-${year}-${String(month).padStart(2, '0')}`,
    tenantId: currentTenantId,
    month,
    year,
    status,
    automatic: true,
    completedAt: status === 'DONE' ? mostRecentDate(items.map((item) => item.completedAt)) : null,
    createdAt: start,
    updatedAt: new Date(),
    progress: items.length ? Math.round((done / items.length) * 100) : 0,
    done,
    total: items.length,
    items,
    message: 'Checklist automático: cada item é concluído pelas ações reais feitas no NexTax. Não existe marcação manual.',
  };
}

function labels<const T extends readonly string[]>(values: T, dictionary: Record<T[number], string>) {
  return values.map((value) => ({ value, label: dictionary[value as T[number]] }));
}

const meta = {
  paymentMethods: labels(paymentMethods, {
    PIX: 'Pix',
    CASH: 'Dinheiro',
    CARD: 'Cartão',
    BOLETO: 'Boleto',
    TRANSFER: 'Transferência',
    OTHER: 'Outro',
  }),
  revenueCategories: labels(revenueCategories, {
    SERVICE: 'Serviço',
    PRODUCT: 'Produto',
    RECURRING: 'Recorrente',
    OCCASIONAL: 'Avulso',
    OTHER: 'Outro',
  }),
  expenseCategories: labels(expenseCategories, {
    RENT: 'Aluguel',
    ENERGY: 'Energia',
    INTERNET: 'Internet',
    ACCOUNTANT: 'Contador',
    SUPPLIER: 'Fornecedor',
    TRANSPORT: 'Transporte',
    MARKETING: 'Marketing',
    SOFTWARE: 'Software',
    CARD_MACHINE: 'Maquininha',
    WORK_MATERIAL: 'Material de trabalho',
    MAINTENANCE: 'Manutenção',
    FOOD: 'Alimentação',
    OTHER: 'Outro',
  }),
  obligationTypes: labels(obligationTypes, {
    DAS_MEI: 'DAS MEI',
    DAS_SIMPLES: 'DAS Simples Nacional',
    MUNICIPAL_GUIDE: 'Guia municipal',
    CUSTOM_TAX: 'Imposto personalizado',
    OTHER: 'Outro',
  }),
  obligationStatuses: labels(obligationStatuses, {
    PENDING: 'Pendente',
    PAID: 'Pago',
    OVERDUE: 'Atrasado',
    IGNORED: 'Ignorado',
    REVIEWING: 'Em revisão',
  }),
  documentTypes: labels(documentTypes, {
    DAS: 'DAS',
    INVOICE: 'Nota fiscal',
    RECEIPT: 'Recibo',
    STATEMENT: 'Extrato',
    CONTRACT: 'Contrato',
    COMPANY_DOCUMENT: 'Documento da empresa',
    PERSONAL_DOCUMENT: 'Documento pessoal',
    REPORT: 'Relatório',
    OTHER: 'Outro',
  }),
  documentStatuses: labels(documentStatuses, {
    PENDING: 'Pendente',
    REVIEWED: 'Revisado',
    SENT_TO_ACCOUNTANT: 'Enviado ao contador',
    APPROVED: 'Aprovado',
    REJECTED: 'Rejeitado',
    NEEDS_FIX: 'Precisa corrigir',
  }),
  taxRegimes: labels(taxRegimes, {
    MEI: 'MEI',
    SIMPLES_NACIONAL: 'Simples Nacional',
    AUTONOMO: 'Autônomo',
    UNKNOWN: 'Ainda não definido',
    OTHER: 'Outro',
  }),
  businessTypes: labels(businessTypes, {
    SERVICE: 'Serviço',
    COMMERCE: 'Comércio',
    INDUSTRY: 'Indústria',
    SERVICE_AND_COMMERCE: 'Serviço e comércio',
    OTHER: 'Outro',
  }),
  plans: PLAN_ORDER.map((value) => ({ value, label: PLAN_LABELS[value] })),
  integrations: Object.values(integrationCatalog()).map((integration) => ({ value: integration.key, label: integration.label, description: integration.description })),
  planLimits: NEXTAX_PLAN_LIMITS,
};
function amountToCents(value: number) {
  return Math.round(value * 100);
}

function centsToAmount(value: number) {
  return Number((value / 100).toFixed(2));
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function publicUrl(path: string) {
  return `${env.API_PUBLIC_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function webUrl(path: string) {
  return `${env.WEB_ORIGIN.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function billingBackUrl(kind: 'success' | 'failure' | 'pending') {
  if (kind === 'success') return env.MERCADO_PAGO_SUCCESS_URL || webUrl('/?billing=success');
  if (kind === 'failure') return env.MERCADO_PAGO_FAILURE_URL || webUrl('/?billing=failure');
  return env.MERCADO_PAGO_PENDING_URL || webUrl('/?billing=pending');
}

function requireMercadoPagoAccessToken() {
  if (!env.MERCADO_PAGO_ACCESS_TOKEN) {
    throw new AppError('MERCADO_PAGO_ACCESS_TOKEN não configurado no Render da API.', 503);
  }

  return env.MERCADO_PAGO_ACCESS_TOKEN;
}

async function mercadoPagoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = requireMercadoPagoAccessToken();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.message || payload?.error || 'Erro ao comunicar com Mercado Pago';
    throw new AppError(`Mercado Pago: ${message}`, response.status >= 500 ? 502 : response.status);
  }

  return payload as T;
}

function billingCatalog(access: Awaited<ReturnType<typeof getTenantAccess>>) {
  const currentRank = planIndex(access.plan);
  const enabledIntegrationKeys = new Set(access.integrations.map((integration) => integration.key));
  const catalog = integrationCatalog();

  return {
    provider: 'MERCADO_PAGO',
    publicKeyConfigured: Boolean(env.MERCADO_PAGO_PUBLIC_KEY),
    checkoutConfigured: Boolean(env.MERCADO_PAGO_ACCESS_TOKEN && env.MERCADO_PAGO_PUBLIC_KEY && env.MERCADO_PAGO_WEBHOOK_SECRET && env.API_PUBLIC_URL),
    currentPlan: { code: access.plan, label: PLAN_LABELS[access.plan], rank: currentRank, expiresAt: access.planExpiresAt, expired: access.planExpired },
    plans: (['STARTER', 'PRO', 'BUSINESS'] as PaidPlanCode[]).map((code) => ({
      code,
      label: PLAN_LABELS[code],
      price: PLAN_PRICES[code],
      amountCents: amountToCents(PLAN_PRICES[code]),
      currency: 'BRL',
      current: access.plan === code,
      upgradeAvailable: planIndex(code) > currentRank,
      renewalAvailable: access.plan === code,
    })),
    addons: (Object.keys(catalog) as IntegrationCode[]).map((key) => ({
      key,
      label: catalog[key].label,
      description: catalog[key].description,
      price: INTEGRATION_ADDON_PRICES[key],
      amountCents: amountToCents(INTEGRATION_ADDON_PRICES[key]),
      currency: 'BRL',
      enabled: enabledIntegrationKeys.has(key),
      includedInCurrentPlan: NEXTAX_PLAN_LIMITS[access.plan].integrations.includes(key),
    })),
  };
}

function checkoutTitle(itemType: BillingItemType, plan?: PaidPlanCode, integrationKey?: IntegrationCode) {
  if (itemType === 'PLAN' && plan) return `NexTax ${PLAN_LABELS[plan]} - 31 dias de acesso`;
  if (itemType === 'INTEGRATION_ADDON' && integrationKey) return `NexTax add-on ${integrationCatalog()[integrationKey].label} - 31 dias`;
  return 'NexTax acesso';
}

function checkoutDescription(itemType: BillingItemType, plan?: PaidPlanCode, integrationKey?: IntegrationCode) {
  if (itemType === 'PLAN' && plan) return `Liberação automática do plano ${PLAN_LABELS[plan]} no NexTax após pagamento aprovado.`;
  if (itemType === 'INTEGRATION_ADDON' && integrationKey) return `Liberação automática da integração ${integrationCatalog()[integrationKey].label} por 31 dias após pagamento aprovado.`;
  return 'Liberação automática no NexTax após pagamento aprovado.';
}

async function createMercadoPagoPreference(input: {
  checkoutId: string;
  externalReference: string;
  title: string;
  description: string;
  amountCents: number;
  user: { name?: string | null; email?: string | null };
  metadata: Record<string, unknown>;
}) {
  return mercadoPagoRequest<{ id: string; init_point?: string; sandbox_init_point?: string }>('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [
        {
          id: input.checkoutId,
          title: input.title,
          description: input.description,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: centsToAmount(input.amountCents),
        },
      ],
      payer: {
        name: input.user.name || undefined,
        email: input.user.email || undefined,
      },
      external_reference: input.externalReference,
      metadata: input.metadata,
      notification_url: publicUrl('/webhooks/mercadopago'),
      back_urls: {
        success: billingBackUrl('success'),
        failure: billingBackUrl('failure'),
        pending: billingBackUrl('pending'),
      },
      auto_return: 'approved',
      statement_descriptor: env.MERCADO_PAGO_STATEMENT_DESCRIPTOR,
    }),
  });
}

async function fetchMercadoPagoPayment(paymentId: string) {
  return mercadoPagoRequest<any>(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

function parseMercadoPagoSignature(signatureHeader: unknown) {
  const value = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (typeof value !== 'string') return {} as Record<string, string>;

  return value.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key && rest.length) acc[key] = rest.join('=');
    return acc;
  }, {});
}

function verifyMercadoPagoWebhook(req: any) {
  if (!env.MERCADO_PAGO_WEBHOOK_SECRET) {
    throw new AppError('MERCADO_PAGO_WEBHOOK_SECRET não configurado para validar webhook.', 500);
  }

  const signature = parseMercadoPagoSignature(req.headers['x-signature']);
  const requestIdHeader = req.headers['x-request-id'];
  const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
  const paymentId = String(req.body?.data?.id || req.query?.['data.id'] || req.query?.id || '');

  if (!signature.ts || !signature.v1 || !requestId || !paymentId) {
    throw new AppError('Webhook Mercado Pago sem assinatura válida.', 401);
  }

  const manifest = `id:${paymentId};request-id:${requestId};ts:${signature.ts};`;
  const expected = crypto.createHmac('sha256', env.MERCADO_PAGO_WEBHOOK_SECRET).update(manifest).digest('hex');
  const received = signature.v1;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');

  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new AppError('Assinatura do webhook Mercado Pago inválida.', 401);
  }
}

async function applyApprovedBillingCheckout(checkout: any, payment: any, status: BillingStatus) {
  const paymentId = String(payment.id);
  const approvedAt = payment.date_approved ? new Date(payment.date_approved) : new Date();

  return prisma.$transaction(async (tx: any) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: checkout.tenantId },
      select: { plan: true, planExpiresAt: true },
    });

    const renewalBase =
      checkout.itemType === 'PLAN' &&
      checkout.targetPlan &&
      tenant?.plan === checkout.targetPlan &&
      tenant?.planExpiresAt &&
      tenant.planExpiresAt > approvedAt
        ? tenant.planExpiresAt
        : approvedAt;

    const periodStart = checkout.periodStart ?? renewalBase;
    const periodEnd = checkout.periodEnd ?? addDays(periodStart, 31);
    const updatedCheckout = await tx.billingCheckout.update({
      where: { id: checkout.id },
      data: {
        status,
        providerPaymentId: paymentId,
        rawPayment: payment,
        paidAt: status === 'APPROVED' ? approvedAt : checkout.paidAt,
        periodStart: status === 'APPROVED' ? periodStart : checkout.periodStart,
        periodEnd: status === 'APPROVED' ? periodEnd : checkout.periodEnd,
      },
    });

    if (status === 'APPROVED' && checkout.status !== 'APPROVED') {
      if (checkout.itemType === 'PLAN' && checkout.targetPlan) {
        await tx.tenant.update({ where: { id: checkout.tenantId }, data: { plan: checkout.targetPlan, planExpiresAt: periodEnd } });
      }

      await tx.auditLog.create({
        data: {
          tenantId: checkout.tenantId,
          userId: checkout.userId,
          action: checkout.itemType === 'PLAN' ? 'BILLING_PLAN_APPROVED' : 'BILLING_ADDON_APPROVED',
          entity: 'BillingCheckout',
          entityId: checkout.id,
          metadata: { paymentId, targetPlan: checkout.targetPlan, integrationKey: checkout.integrationKey, periodStart, periodEnd },
        },
      });
    }

    return updatedCheckout;
  });
}

async function revokeBillingCheckoutIfNeeded(checkout: any, payment: any, status: BillingStatus) {
  const paymentId = String(payment.id);

  return prisma.$transaction(async (tx: any) => {
    const updatedCheckout = await tx.billingCheckout.update({
      where: { id: checkout.id },
      data: { status, providerPaymentId: paymentId, rawPayment: payment },
    });

    if (checkout.status === 'APPROVED' && checkout.itemType === 'PLAN' && checkout.targetPlan && checkout.periodEnd) {
      const tenant = await tx.tenant.findUnique({ where: { id: checkout.tenantId }, select: { plan: true, planExpiresAt: true } });
      const samePeriod = tenant?.planExpiresAt && new Date(tenant.planExpiresAt).getTime() === new Date(checkout.periodEnd).getTime();

      if (tenant?.plan === checkout.targetPlan && samePeriod) {
        await tx.tenant.update({ where: { id: checkout.tenantId }, data: { plan: 'FREE', planExpiresAt: null } });
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId: checkout.tenantId,
        userId: checkout.userId,
        action: 'BILLING_PAYMENT_STATUS_CHANGED',
        entity: 'BillingCheckout',
        entityId: checkout.id,
        metadata: { paymentId, status, mercadoPagoStatus: payment.status },
      },
    });

    return updatedCheckout;
  });
}

async function processMercadoPagoPayment(payment: any, expectedTenantId?: string) {
  const externalReference = String(payment.external_reference || payment.metadata?.external_reference || '');
  if (!externalReference) return { ignored: true, reason: 'missing_external_reference' };

  const checkout = await prisma.billingCheckout.findUnique({ where: { externalReference } });
  if (!checkout) return { ignored: true, reason: 'checkout_not_found', externalReference };
  if (expectedTenantId && checkout.tenantId !== expectedTenantId) throw new AppError('Pagamento não pertence a esta empresa.', 403);

  const status = BILLING_STATUS_BY_MERCADO_PAGO[String(payment.status || '').toLowerCase()] || 'ERROR';

  if (status === 'APPROVED') {
    const updated = await applyApprovedBillingCheckout(checkout, payment, status);
    const access = await getTenantAccess(checkout.tenantId);
    return { ok: true, checkout: updated, access: publicAccessPayload(access) };
  }

  if (['REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK'].includes(status)) {
    const updated = await revokeBillingCheckoutIfNeeded(checkout, payment, status);
    const access = await getTenantAccess(checkout.tenantId);
    return { ok: true, checkout: updated, access: publicAccessPayload(access) };
  }

  const updated = await prisma.billingCheckout.update({
    where: { id: checkout.id },
    data: { status, providerPaymentId: String(payment.id), rawPayment: payment },
  });

  return { ok: true, checkout: updated };
}



r.get('/health', (_req, res) => res.json({ ok: true, service: 'nextax-api' }));

r.get('/health/ready', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: true });
  } catch (e) {
    next(e);
  }
});

r.get('/meta', (_req, res) => res.json(meta));

r.post('/auth/signup', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(2), email: z.string().email(), password }).parse(req.body);
    const user = await signup(body.name, body.email, body.password);
    const verification = await createEmailVerification(user.id);

    res.status(201).json({
      ok: true,
      verificationRequired: true,
      verificationSent: !verification.alreadyVerified,
      message: 'Conta criada. Confirme seu e-mail antes de entrar.',
      verifyUrl: env.NODE_ENV === 'production' ? undefined : verification.verifyUrl,
    });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(body.email) } });

    if (!user || user.deletedAt || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new AppError('Credenciais inválidas', 401);
    }

    res.json(await issueSession(res, user.id));
  } catch (e) {
    next(e);
  }
});

r.post('/auth/forgot-password', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const resetUrl = await createPasswordReset(body.email);

    res.json({
      ok: true,
      message: 'Se o e-mail existir, enviaremos instruções para redefinir a senha.',
      resetUrl: env.NODE_ENV === 'production' ? undefined : resetUrl,
    });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/reset-password', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(32), password }).parse(req.body);
    await resetPassword(body.token, body.password);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/verify-email', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(32) }).parse(req.body);
    await verifyEmail(body.token);
    res.json({ ok: true, message: 'E-mail confirmado com sucesso.' });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/resend-verification', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(body.email) }, select: { id: true, origin: true, deletedAt: true } });
    let result: Awaited<ReturnType<typeof createEmailVerification>> | null = null;

    if (user && !user.deletedAt && user.origin === 'NEXTAX') {
      result = await createEmailVerification(user.id);
    }

    res.json({
      ok: true,
      alreadyVerified: result?.alreadyVerified ?? false,
      message: 'Se o e-mail existir e ainda não estiver confirmado, enviaremos um novo link de confirmação.',
      verifyUrl: env.NODE_ENV === 'production' ? undefined : result?.verifyUrl ?? undefined,
    });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/change-password', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: password }).parse(req.body);
    await changeOwnPassword({ userId: userId(req), currentPassword: body.currentPassword, newPassword: body.newPassword });
    await logout(req, res);
    await audit(req, 'PASSWORD_CHANGED', 'User', userId(req));
    res.json({ ok: true, message: 'Senha alterada. Faça login novamente.' });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/nexcore/exchange', loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(32), app: z.string().default('nextax') }).parse(req.body);
    const response = await fetch(nexCoreUrl('/sso/exchange'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nexcore-product-key': env.NEXCORE_PRODUCT_KEY },
      body: JSON.stringify({ token: body.token, app: body.app }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new AppError(error?.message || 'Não foi possível validar o acesso pelo NexCore', response.status);
    }

    const data = (await response.json()) as {
      user?: { id?: string | null; name?: string | null; email?: string };
      tenant?: { id?: string | null; name?: string | null; slug?: string | null };
      plan?: string;
      vipExpiresAt?: string | null;
      integrations?: string[];
      integrationAddons?: string[];
      access?: { plan?: string; enabledIntegrations?: string[]; integrationAddons?: string[]; vipExpiresAt?: string | null };
      subscription?: { plan?: string; enabledIntegrations?: string[]; integrationAddons?: string[]; vipExpiresAt?: string | null };
    };
    if (!data.user?.email) throw new AppError('Resposta SSO inválida', 502);

    const rawPlan = data.access?.plan ?? data.subscription?.plan ?? data.plan;
    const plan = isPlanCode(rawPlan) ? rawPlan : undefined;
    const enabledIntegrations = optionalIntegrationsFrom(data.access?.enabledIntegrations, data.subscription?.enabledIntegrations, data.integrations);
    const integrationAddons = optionalIntegrationsFrom(data.access?.integrationAddons, data.subscription?.integrationAddons, data.integrationAddons);
    const planExpiresAt = planExpirationFor(plan, data.access?.vipExpiresAt ?? data.subscription?.vipExpiresAt ?? data.vipExpiresAt);

    const user = await upsertNexCoreUser({
      name: data.user.name || data.user.email,
      email: data.user.email,
      tenantName: data.tenant?.name || undefined,
      nexcoreTenantId: data.tenant?.id || undefined,
      plan,
      planExpiresAt,
      enabledIntegrations,
      integrationAddons,
    });

    res.json(await issueSession(res, user.id));
  } catch (e) {
    next(e);
  }
});

r.post('/auth/refresh', async (req, res, next) => {
  try {
    res.json(await rotateRefresh(req, res));
  } catch (e) {
    next(e);
  }
});

r.post('/auth/logout', async (req, res, next) => {
  try {
    await logout(req, res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const currentTenantId = tenantId(req);
    const [user, member, access] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId(req) }, select: { id: true, name: true, email: true, role: true, origin: true, emailVerifiedAt: true } }),
      prisma.tenantMember.findFirst({
        where: { userId: userId(req), tenantId: currentTenantId },
        select: {
          role: true,
          tenant: {
            select: {
              id: true,
              name: true,
              taxProfile: true,
              plan: true,
              planExpiresAt: true,
              origin: true,
              enabledIntegrations: true,
              integrationAddons: true,
            },
          },
        },
      }),
      getTenantAccess(currentTenantId),
    ]);

    res.json({
      user,
      tenant: member?.tenant ?? null,
      tenantId: currentTenantId,
      role: member?.role ?? req.user?.role,
      access: publicAccessPayload(access, user?.origin, member?.tenant?.origin),
    });
  } catch (e) {
    next(e);
  }
});

r.post('/auth/nexcore/return-session', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId(req) } });
    if (!user || user.origin !== 'NEXCORE') {
      throw new AppError('Esta conta não foi criada pelo NexCore. Use o login direto do NexTax.', 403);
    }

    const response = await fetch(nexCoreUrl('/auth/return'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-api-key': env.NEXCORE_INTERNAL_API_KEY },
      body: JSON.stringify({ product: 'NEXTAX', email: user?.email, name: user?.name, returnTo: env.NEXCORE_APP_URL }),
    });

    if (!response.ok) return res.json({ url: env.NEXCORE_APP_URL });

    const data = (await response.json()) as { url?: string };
    return res.json({ url: data.url ?? env.NEXCORE_APP_URL });
  } catch (e) {
    next(e);
  }
});


r.get('/companies', requireAuth, async (req, res, next) => {
  try {
    const memberships = await prisma.tenantMember.findMany({
      where: { userId: userId(req), tenant: { deletedAt: null } },
      include: { tenant: { select: { id: true, name: true, taxProfile: true, plan: true, planExpiresAt: true, origin: true, createdAt: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ currentTenantId: tenantId(req), companies: memberships.map((membership: any) => ({ role: membership.role, tenant: membership.tenant })) });
  } catch (e) {
    next(e);
  }
});

r.post('/companies', requireAuth, requireRole('OWNER', 'ADMIN'), writeLimiter, async (req, res, next) => {
  try {
    const access = await getTenantAccess(tenantId(req));
    if (!access.limits.multiCompany) {
      throw new AppError('Multiempresa está disponível somente no plano Business.', 403);
    }

    const body = z.object({ name: z.string().trim().min(2).max(120), taxProfile: z.enum(taxRegimes).default('UNKNOWN') }).parse(req.body);
    const currentUserId = userId(req);

    const tenant = await prisma.$transaction(async (tx: any) => {
      const created = await tx.tenant.create({
        data: {
          name: body.name,
          ownerId: currentUserId,
          taxProfile: body.taxProfile,
          plan: 'BUSINESS',
          planExpiresAt: access.planExpiresAt,
          enabledIntegrations: access.tenant.enabledIntegrations,
          integrationAddons: access.tenant.integrationAddons,
          origin: access.tenant.origin,
        },
      });

      await tx.tenantMember.create({ data: { tenantId: created.id, userId: currentUserId, role: 'OWNER' } });
      await tx.fiscalProfile.create({ data: { tenantId: created.id } });
      await tx.auditLog.create({ data: { tenantId: created.id, userId: currentUserId, action: 'COMPANY_CREATED', entity: 'Tenant', entityId: created.id } });
      return created;
    });

    res.status(201).json({ ok: true, tenant });
  } catch (e) {
    next(e);
  }
});

r.post('/companies/:tenantId/switch', requireAuth, async (req, res, next) => {
  try {
    const targetTenantId = str(req.params.tenantId);
    const [user, membership] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId(req) }, select: { id: true, email: true, deletedAt: true } }),
      prisma.tenantMember.findFirst({ where: { userId: userId(req), tenantId: targetTenantId, tenant: { deletedAt: null } }, select: { role: true } }),
    ]);

    if (!user || user.deletedAt || !membership) throw new AppError('Empresa não encontrada para este usuário.', 404);

    res.json({
      ok: true,
      accessToken: signAccess({ id: user.id, tenantId: targetTenantId, email: user.email, role: membership.role as any }),
      tenantId: targetTenantId,
    });
  } catch (e) {
    next(e);
  }
});


const internalNexCoreUserSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
}).optional();

const internalNexCoreTenantSchema = z.object({
  id: z.string().min(3).optional().nullable(),
  name: z.string().optional().nullable(),
  slug: z.string().optional().nullable(),
}).optional();

const internalMembershipSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'READER']).optional().nullable(),
}).optional();

function roleFromNexCore(value: unknown) {
  return ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'READER'].includes(String(value))
    ? String(value) as 'OWNER' | 'ADMIN' | 'FINANCE' | 'ACCOUNTANT' | 'READER'
    : 'OWNER';
}

const internalAccessSyncSchema = z.object({
  source: z.string().optional(),
  app: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  user: internalNexCoreUserSchema,
  tenant: internalNexCoreTenantSchema,
  tenantId: z.string().min(3).optional(),
  plan: z.enum(['FREE', 'STARTER', 'PRO', 'BUSINESS']).optional(),
  nexcorePlan: z.enum(['FREE', 'VIP']).optional(),
  vipExpiresAt: z.union([z.string(), z.null()]).optional(),
  planExpiresAt: z.union([z.string(), z.null()]).optional(),
  enabledIntegrations: z.array(z.enum(['NEXFINANCE', 'NEXSTOCK', 'NEXCRM'])).optional(),
  integrationAddons: z.array(z.enum(['NEXFINANCE', 'NEXSTOCK', 'NEXCRM'])).optional(),
  membership: internalMembershipSchema,
});

function payloadEmail(body: z.infer<typeof internalAccessSyncSchema>) {
  return body.email || body.user?.email || undefined;
}

function payloadName(body: z.infer<typeof internalAccessSyncSchema>) {
  const email = payloadEmail(body);
  return body.name || body.user?.name || email?.split('@')[0] || 'Usuário NexCore';
}

function payloadTenantId(body: { tenantId?: string; tenant?: { id?: string | null } }) {
  return body.tenantId || body.tenant?.id || undefined;
}

function payloadTenantName(body: z.infer<typeof internalAccessSyncSchema>) {
  return body.tenant?.name || (payloadEmail(body) ? `Empresa de ${payloadName(body)}` : 'Empresa NexCore');
}

async function findTenantForInternalPayload(input: { tenantId?: string; email?: string }) {
  if (input.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
    if (tenant) return tenant;
  }

  if (input.email) {
    return prisma.tenant.findFirst({
      where: {
        members: { some: { user: { email: normalizeEmail(input.email) } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  return null;
}

r.post('/internal/access/sync', async (req, res, next) => {
  try {
    requireInternalApiKey(req);
    const body = internalAccessSyncSchema.parse(req.body);
    const email = payloadEmail(body);
    const nexcoreTenantId = payloadTenantId(body);
    const expiresAt = body.vipExpiresAt ?? body.planExpiresAt;
    const membershipRole = roleFromNexCore(body.membership?.role);

    if (!email && !nexcoreTenantId) {
      throw new AppError('Informe email, user.email, tenant.id ou tenantId para sincronizar acesso.', 400);
    }

    let tenant = await findTenantForInternalPayload({ tenantId: nexcoreTenantId, email });

    if (!tenant) {
      if (!email) throw new AppError('E-mail é obrigatório para criar acesso NexCore no NexTax.', 400);

      const user = await upsertNexCoreUser({
        name: payloadName(body),
        email,
        tenantName: payloadTenantName(body),
        nexcoreTenantId,
        plan: body.plan,
        planExpiresAt: planExpirationFor(body.plan, expiresAt),
        enabledIntegrations: body.plan === 'FREE' ? [] : body.enabledIntegrations,
        integrationAddons: body.plan === 'FREE' ? [] : body.integrationAddons,
        membershipRole,
      });

      tenant = await findTenantForInternalPayload({ tenantId: nexcoreTenantId, email: user.email });
      if (!tenant) throw new AppError('Não foi possível criar empresa para sincronização NexCore.', 500);
    } else {
      const data = {
        origin: 'NEXCORE' as const,
        ...(body.tenant?.name ? { name: body.tenant.name } : {}),
        ...planAccessData({
          plan: body.plan,
          expiresAt,
          enabledIntegrations: body.enabledIntegrations,
          integrationAddons: body.integrationAddons,
        }),
      };

      tenant = await prisma.tenant.update({ where: { id: tenant.id }, data });

      if (email) {
        const normalizedEmail = normalizeEmail(email);
        let syncUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (!syncUser) {
          syncUser = await prisma.user.create({
            data: {
              name: payloadName(body),
              email: normalizedEmail,
              passwordHash: await bcrypt.hash(crypto.randomBytes(36).toString('hex'), 12),
              origin: 'NEXCORE',
              emailVerifiedAt: new Date(),
            },
          });
        } else {
          syncUser = await prisma.user.update({
            where: { id: syncUser.id },
            data: {
              origin: 'NEXCORE',
              emailVerifiedAt: syncUser.emailVerifiedAt ?? new Date(),
              ...(payloadName(body) ? { name: payloadName(body) } : {}),
            },
          });
        }

        await prisma.tenantMember.upsert({
          where: { tenantId_userId: { tenantId: tenant.id, userId: syncUser.id } },
          update: { role: membershipRole },
          create: { tenantId: tenant.id, userId: syncUser.id, role: membershipRole },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: 'NEXCORE_ACCESS_SYNC',
        entity: 'Tenant',
        entityId: tenant.id,
        metadata: JSON.parse(JSON.stringify({
          source: body.source,
          app: body.app,
          plan: body.plan,
          nexcorePlan: body.nexcorePlan,
          vipExpiresAt: body.vipExpiresAt ?? null,
        })) as Prisma.InputJsonValue,
      },
    }).catch(() => null);

    const access = await getTenantAccess(tenant.id);

    res.json({
      ok: true,
      tenantId: tenant.id,
      plan: access.plan,
      nexcorePlan: body.nexcorePlan ?? null,
      vipExpiresAt: body.vipExpiresAt ?? null,
      access: publicAccessPayload(access),
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

const internalTenantDeactivateSchema = z.object({
  source: z.string().optional(),
  app: z.string().optional(),
  tenantId: z.string().min(3).optional(),
  tenant: internalNexCoreTenantSchema,
  user: internalNexCoreUserSchema,
  reason: z.string().optional(),
});

r.post('/internal/tenant/deactivate', async (req, res, next) => {
  try {
    requireInternalApiKey(req);
    const body = internalTenantDeactivateSchema.parse(req.body);
    const nexcoreTenantId = payloadTenantId(body);
    const email = body.user?.email || undefined;

    if (!nexcoreTenantId && !email) {
      throw new AppError('Informe tenantId, tenant.id ou user.email para desativar empresa.', 400);
    }

    const tenant = await findTenantForInternalPayload({ tenantId: nexcoreTenantId, email });

    if (!tenant) {
      return res.json({
        ok: true,
        skipped: true,
        tenantId: nexcoreTenantId ?? null,
        message: 'Empresa não encontrada no NexTax; desativação idempotente.',
        syncedAt: new Date().toISOString(),
      });
    }

    const members = await prisma.tenantMember.findMany({ where: { tenantId: tenant.id }, select: { userId: true } });
    const userIds = members.map((member: { userId: string }) => member.userId);
    const now = new Date();

    await prisma.$transaction(async (tx: any) => {
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          action: 'NEXCORE_TENANT_DEACTIVATE',
          entity: 'Tenant',
          entityId: tenant.id,
          metadata: JSON.parse(JSON.stringify({
            source: body.source,
            app: body.app,
            reason: body.reason,
            nexcoreTenantId,
          })) as Prisma.InputJsonValue,
        },
      });

      await tx.billingCheckout.updateMany({
        where: { tenantId: tenant.id, status: { in: ['PENDING', 'AUTHORIZED', 'IN_PROCESS'] } },
        data: { status: 'CANCELLED' },
      });

      if (userIds.length) {
        await tx.refreshToken.updateMany({
          where: { userId: { in: userIds }, revokedAt: null },
          data: { revokedAt: now },
        });
      }

      await tx.tenantMember.deleteMany({ where: { tenantId: tenant.id } });
      await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          plan: 'FREE',
          planExpiresAt: null,
          enabledIntegrations: [],
          integrationAddons: [],
          origin: 'NEXCORE' as const,
          deletedAt: now,
        },
      });
    });

    res.json({
      ok: true,
      tenantId: tenant.id,
      status: 'DISABLED',
      plan: 'FREE',
      syncedAt: now.toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

const billingCheckoutSchema = z.object({
  itemType: z.enum(['PLAN', 'INTEGRATION_ADDON']),
  plan: z.enum(['STARTER', 'PRO', 'BUSINESS']).optional(),
  integrationKey: z.enum(['NEXFINANCE', 'NEXSTOCK', 'NEXCRM']).optional(),
});

r.get('/billing/catalog', requireAuth, async (req, res, next) => {
  try {
    const access = await getTenantAccess(tenantId(req));
    res.json(billingCatalog(access));
  } catch (e) {
    next(e);
  }
});

r.get('/billing/checkouts', requireAuth, async (req, res, next) => {
  try {
    const checkouts = await prisma.billingCheckout.findMany({
      where: { tenantId: tenantId(req) },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    res.json(checkouts);
  } catch (e) {
    next(e);
  }
});

r.post('/billing/checkout', requireAuth, requireRole('OWNER'), writeLimiter, async (req, res, next) => {
  try {
    const body = billingCheckoutSchema.parse(req.body);
    await requireVerifiedEmail(req);
    const access = await getTenantAccess(tenantId(req));

    let itemType: BillingItemType = body.itemType;
    let targetPlan: PaidPlanCode | undefined;
    let integrationKey: IntegrationCode | undefined;
    let amountCents = 0;

    if (itemType === 'PLAN') {
      if (!body.plan) throw new AppError('Informe o plano para criar checkout.', 400);
      targetPlan = body.plan;

      const isRenewal = targetPlan === access.plan;
      const isUpgrade = planIndex(targetPlan) > planIndex(access.plan);

      if (!isRenewal && !isUpgrade) {
        throw new AppError('Downgrade de plano deve ser tratado manualmente para evitar perda acidental de acesso.', 400);
      }

      amountCents = amountToCents(PLAN_PRICES[targetPlan]);
    }

    if (itemType === 'INTEGRATION_ADDON') {
      if (!body.integrationKey) throw new AppError('Informe a integração para criar checkout.', 400);
      integrationKey = body.integrationKey;

      if (access.integrations.some((integration) => integration.key === integrationKey)) {
        throw new AppError('Essa integração já está liberada para sua conta.', 400);
      }

      amountCents = amountToCents(INTEGRATION_ADDON_PRICES[integrationKey]);
    }

    const currentUser = await prisma.user.findUnique({ where: { id: userId(req) }, select: { id: true, name: true, email: true } });
    if (!currentUser) throw new AppError('Usuário não encontrado.', 404);

    const externalReference = `NEXTAX-${crypto.randomUUID()}`;
    const checkout = await prisma.billingCheckout.create({
      data: {
        tenantId: tenantId(req),
        userId: userId(req),
        itemType,
        targetPlan,
        integrationKey,
        amountCents,
        currency: 'BRL',
        externalReference,
      },
    });

    try {
      const preference = await createMercadoPagoPreference({
        checkoutId: checkout.id,
        externalReference,
        title: checkoutTitle(itemType, targetPlan, integrationKey),
        description: checkoutDescription(itemType, targetPlan, integrationKey),
        amountCents,
        user: currentUser,
        metadata: {
          checkout_id: checkout.id,
          tenant_id: checkout.tenantId,
          user_id: checkout.userId,
          item_type: itemType,
          target_plan: targetPlan,
          integration_key: integrationKey,
          external_reference: externalReference,
        },
      });

      const updated = await prisma.billingCheckout.update({
        where: { id: checkout.id },
        data: {
          providerPreferenceId: preference.id,
          initPoint: preference.init_point,
          sandboxInitPoint: preference.sandbox_init_point,
          rawPreference: preference,
        },
      });

      res.status(201).json({
        checkoutId: updated.id,
        preferenceId: updated.providerPreferenceId,
        initPoint: updated.initPoint,
        sandboxInitPoint: updated.sandboxInitPoint,
        externalReference: updated.externalReference,
      });
    } catch (e) {
      await prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: 'ERROR' } }).catch(() => null);
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

r.post('/billing/mercadopago/confirm', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const body = z.object({ paymentId: z.string().min(3) }).parse(req.body);
    const payment = await fetchMercadoPagoPayment(body.paymentId);
    const result = await processMercadoPagoPayment(payment, tenantId(req));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

r.post('/webhooks/mercadopago', async (req, res, next) => {
  try {
    verifyMercadoPagoWebhook(req);

    const paymentId = String(req.body?.data?.id || req.query?.['data.id'] || req.query?.id || '');
    const topic = String(req.body?.type || req.body?.topic || req.query?.topic || '').toLowerCase();

    if (!paymentId || (topic && !topic.includes('payment'))) {
      return res.json({ ok: true, ignored: true });
    }

    const payment = await fetchMercadoPagoPayment(paymentId);
    const result = await processMercadoPagoPayment(payment);
    res.json({ ok: true, result });
  } catch (e) {
    next(e);
  }
});


r.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const access = await requirePageAccess(req, 'dashboard');
    const requested = z
      .object({ month: z.coerce.number().int().min(1).max(12).optional(), year: z.coerce.number().int().min(2020).optional() })
      .parse(req.query);
    const fallback = currentMonthYear();
    const month = requested.month ?? fallback.month;
    const year = requested.year ?? fallback.year;
    const { start, end } = rangeMonth(month, year);
    const currentTenantId = tenantId(req);
    const now = new Date();

    const [revenues, expenses, docsPending, overdueObligations, upcomingObligations, profile, yearRevenue, automaticChecklist] = await Promise.all([
      prisma.revenue.aggregate({ where: { tenantId: currentTenantId, receivedAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
      prisma.expense.aggregate({ where: { tenantId: currentTenantId, paidAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
      prisma.fiscalDocument.count({ where: { tenantId: currentTenantId, status: 'PENDING', deletedAt: null } }),
      prisma.taxObligation.count({ where: { tenantId: currentTenantId, status: { in: ['PENDING', 'REVIEWING'] }, dueDate: { lt: now } } }),
      prisma.taxObligation.findMany({
        where: { tenantId: currentTenantId, status: { in: ['PENDING', 'REVIEWING', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
      prisma.fiscalProfile.findUnique({ where: { tenantId: currentTenantId } }),
      prisma.revenue.aggregate({
        where: { tenantId: currentTenantId, receivedAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        _sum: { amount: true },
      }),
      buildAutomaticChecklist(currentTenantId, month, year),
    ]);

    const cashFlow = await Promise.all(
      monthsBack(6).map(async (item) => {
        const period = rangeMonth(item.month, item.year);
        const [revenue, expense] = await Promise.all([
          prisma.revenue.aggregate({ where: { tenantId: currentTenantId, receivedAt: { gte: period.start, lt: period.end } }, _sum: { amount: true } }),
          prisma.expense.aggregate({ where: { tenantId: currentTenantId, paidAt: { gte: period.start, lt: period.end } }, _sum: { amount: true } }),
        ]);

        const revenueTotal = Number(revenue._sum.amount || 0);
        const expenseTotal = Number(expense._sum.amount || 0);
        return { ...item, revenue: revenueTotal, expense: expenseTotal, result: revenueTotal - expenseTotal };
      }),
    );

    const annual = Number(yearRevenue._sum.amount || 0);
    const limit = Number(profile?.meiAnnualLimit || 81_000);
    const checklistProgress = automaticChecklist.progress;
    const monthRevenue = Number(revenues._sum.amount || 0);
    const monthExpense = Number(expenses._sum.amount || 0);

    const score = Math.min(
      100,
      20 +
        (revenues._count ? 15 : 0) +
        (expenses._count ? 15 : 0) +
        (docsPending === 0 ? 20 : 0) +
        (overdueObligations === 0 ? 15 : 0) +
        Math.round(checklistProgress * 0.15),
    );

    res.json({
      period: { month, year },
      monthRevenue,
      monthExpense,
      monthResult: monthRevenue - monthExpense,
      yearRevenue: annual,
      meiLimit: limit,
      meiLimitUsed: limit > 0 ? Math.round((annual / limit) * 100) : 0,
      pendingDocuments: docsPending,
      overdueObligations,
      upcomingObligations,
      checklistProgress,
      organizationScore: score,
      cashFlow,
      disclaimer,
      access: publicAccessPayload(access),
    });
  } catch (e) {
    next(e);
  }
});

const revenueSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount: positiveMoney,
  receivedAt: z.coerce.date(),
  customerName: optionalText,
  customerDocument: optionalText,
  paymentMethod: z.enum(paymentMethods).default('PIX'),
  category: z.enum(revenueCategories).default('SERVICE'),
  hasInvoice: z.coerce.boolean().default(false),
  invoiceId: optionalText,
  documentId: optionalText,
  notes: optionalText,
});

r.get('/revenues', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'revenues');
    const query = paginationSchema.extend({ month: z.coerce.number().int().min(1).max(12).optional(), year: z.coerce.number().int().min(2020).optional() }).parse(req.query);
    const where: any = { tenantId: tenantId(req) };
    if (query.month && query.year) {
      const { start, end } = rangeMonth(query.month, query.year);
      where.receivedAt = { gte: start, lt: end };
    }

    const revenues = await prisma.revenue.findMany({ where, orderBy: { receivedAt: 'desc' }, take: query.limit, skip: query.offset });
    res.json(revenues);
  } catch (e) {
    next(e);
  }
});

r.post('/revenues', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    const body = revenueSchema.parse(req.body);
    await assertMonthlyLimit(req, 'revenues', body.receivedAt);
    const revenue = await prisma.revenue.create({ data: { ...body, tenantId: tenantId(req) } });
    await audit(req, 'REVENUE_CREATED', 'Revenue', revenue.id, { amount: body.amount, receivedAt: body.receivedAt });
    res.status(201).json(revenue);
  } catch (e) {
    next(e);
  }
});

r.patch('/revenues/:id', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'revenues');
    const body = revenueSchema.partial().parse(req.body);
    const updated = await prisma.revenue.updateMany({ where: { id: str(req.params.id), tenantId: tenantId(req) }, data: body });
    if (!updated.count) throw new AppError('Receita não encontrada', 404);
    await audit(req, 'REVENUE_UPDATED', 'Revenue', str(req.params.id), { fields: Object.keys(body) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.delete('/revenues/:id', requireAuth, requireRole('OWNER', 'ADMIN'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'revenues');
    const deleted = await prisma.revenue.deleteMany({ where: { id: str(req.params.id), tenantId: tenantId(req) } });
    if (!deleted.count) throw new AppError('Receita não encontrada', 404);
    await audit(req, 'REVENUE_DELETED', 'Revenue', str(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const expenseSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount: positiveMoney,
  paidAt: z.coerce.date(),
  category: z.enum(expenseCategories).default('OTHER'),
  supplierName: optionalText,
  paymentMethod: z.enum(paymentMethods).default('PIX'),
  isRecurring: z.coerce.boolean().default(false),
  documentId: optionalText,
  notes: optionalText,
});

r.get('/expenses', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'expenses');
    const query = paginationSchema.extend({ month: z.coerce.number().int().min(1).max(12).optional(), year: z.coerce.number().int().min(2020).optional() }).parse(req.query);
    const where: any = { tenantId: tenantId(req) };
    if (query.month && query.year) {
      const { start, end } = rangeMonth(query.month, query.year);
      where.paidAt = { gte: start, lt: end };
    }

    const expenses = await prisma.expense.findMany({ where, orderBy: { paidAt: 'desc' }, take: query.limit, skip: query.offset });
    res.json(expenses);
  } catch (e) {
    next(e);
  }
});

r.post('/expenses', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    const body = expenseSchema.parse(req.body);
    await assertMonthlyLimit(req, 'expenses', body.paidAt);
    const expense = await prisma.expense.create({ data: { ...body, tenantId: tenantId(req) } });
    await audit(req, 'EXPENSE_CREATED', 'Expense', expense.id, { amount: body.amount, paidAt: body.paidAt });
    res.status(201).json(expense);
  } catch (e) {
    next(e);
  }
});

r.patch('/expenses/:id', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'expenses');
    const body = expenseSchema.partial().parse(req.body);
    const updated = await prisma.expense.updateMany({ where: { id: str(req.params.id), tenantId: tenantId(req) }, data: body });
    if (!updated.count) throw new AppError('Despesa não encontrada', 404);
    await audit(req, 'EXPENSE_UPDATED', 'Expense', str(req.params.id), { fields: Object.keys(body) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.delete('/expenses/:id', requireAuth, requireRole('OWNER', 'ADMIN'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'expenses');
    const deleted = await prisma.expense.deleteMany({ where: { id: str(req.params.id), tenantId: tenantId(req) } });
    if (!deleted.count) throw new AppError('Despesa não encontrada', 404);
    await audit(req, 'EXPENSE_DELETED', 'Expense', str(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const obligationSchema = z.object({
  type: z.enum(obligationTypes).default('DAS_MEI'),
  competenceMonth: z.coerce.number().int().min(1).max(12),
  competenceYear: z.coerce.number().int().min(2020),
  dueDate: z.coerce.date(),
  amount: optionalMoney,
  status: z.enum(obligationStatuses).default('PENDING'),
  paidAt: z.coerce.date().optional(),
  notes: optionalText,
});

r.get('/tax-obligations', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'obligations');
    const query = paginationSchema.extend({ month: z.coerce.number().int().min(1).max(12).optional(), year: z.coerce.number().int().min(2020).optional() }).parse(req.query);
    const where: any = { tenantId: tenantId(req) };
    if (query.month) where.competenceMonth = query.month;
    if (query.year) where.competenceYear = query.year;
    const obligations = await prisma.taxObligation.findMany({ where, orderBy: { dueDate: 'asc' }, take: query.limit, skip: query.offset });
    res.json(obligations);
  } catch (e) {
    next(e);
  }
});

r.post('/tax-obligations', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'obligations');
    const body = obligationSchema.parse(req.body);
    const obligation = await prisma.taxObligation.create({ data: { ...body, tenantId: tenantId(req) } });
    await audit(req, 'TAX_OBLIGATION_CREATED', 'TaxObligation', obligation.id, { type: body.type, dueDate: body.dueDate });
    res.status(201).json(obligation);
  } catch (e) {
    next(e);
  }
});

r.patch('/tax-obligations/:id', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'obligations');
    const body = obligationSchema.partial().parse(req.body);
    const updated = await prisma.taxObligation.updateMany({ where: { id: str(req.params.id), tenantId: tenantId(req) }, data: body });
    if (!updated.count) throw new AppError('Obrigação não encontrada', 404);
    await audit(req, 'TAX_OBLIGATION_UPDATED', 'TaxObligation', str(req.params.id), { fields: Object.keys(body) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.post('/tax-obligations/:id/mark-paid', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'obligations');
    const body = z.object({ paidAt: z.coerce.date().optional(), amount: optionalMoney }).parse(req.body);
    const updated = await prisma.taxObligation.updateMany({
      where: { id: str(req.params.id), tenantId: tenantId(req) },
      data: {
        status: 'PAID',
        paidAt: body.paidAt ?? new Date(),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
      },
    });
    if (!updated.count) throw new AppError('Obrigação não encontrada', 404);
    await audit(req, 'TAX_OBLIGATION_MARKED_PAID', 'TaxObligation', str(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.delete('/tax-obligations/:id', requireAuth, requireRole('OWNER', 'ADMIN'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'obligations');
    const deleted = await prisma.taxObligation.deleteMany({ where: { id: str(req.params.id), tenantId: tenantId(req) } });
    if (!deleted.count) throw new AppError('Obrigação não encontrada', 404);
    await audit(req, 'TAX_OBLIGATION_DELETED', 'TaxObligation', str(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const documentFileSchema = z.object({
  originalName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(3).max(120),
  size: z.coerce.number().int().positive(),
  base64: z.string().min(8),
});

const documentCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.enum(documentTypes).default('OTHER'),
  file: documentFileSchema.optional(),
  competenceMonth: z.coerce.number().int().min(1).max(12).optional(),
  competenceYear: z.coerce.number().int().min(2020).optional(),
  status: z.enum(documentStatuses).default('PENDING'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

const documentUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  type: z.enum(documentTypes).optional(),
  competenceMonth: z.coerce.number().int().min(1).max(12).optional(),
  competenceYear: z.coerce.number().int().min(2020).optional(),
  status: z.enum(documentStatuses).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

r.get('/documents', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'documents');
    const query = paginationSchema.extend({ month: z.coerce.number().int().min(1).max(12).optional(), year: z.coerce.number().int().min(2020).optional() }).parse(req.query);
    const where: any = { tenantId: tenantId(req), deletedAt: null };
    if (query.month) where.competenceMonth = query.month;
    if (query.year) where.competenceYear = query.year;
    const documents = await prisma.fiscalDocument.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.limit, skip: query.offset });
    res.json(documents);
  } catch (e) {
    next(e);
  }
});

r.post('/documents', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'), writeLimiter, async (req, res, next) => {
  try {
    await requireVerifiedEmail(req);
    const body = documentCreateSchema.parse(req.body);
    await assertDocumentLimit(req);
    const currentTenantId = tenantId(req);

    if (!body.file) {
      throw new AppError('Selecione um arquivo para enviar ao Supabase Storage.', 400);
    }

    let uploaded: { fileKey: string; mimeType: string; size: number } | null = null;

    if (body.file) {
      const mimeType = normalizeDocumentMimeType(body.file.originalName, body.file.mimeType);
      const buffer = decodeBase64File({ base64: body.file.base64, size: body.file.size, mimeType });
      uploaded = await uploadFiscalDocument({
        tenantId: currentTenantId,
        originalName: body.file.originalName,
        mimeType,
        buffer,
      });
    }

    const document = await prisma.fiscalDocument.create({
      data: {
        tenantId: currentTenantId,
        uploadedBy: userId(req),
        name: body.name,
        type: body.type,
        fileUrl: undefined,
        fileKey: uploaded?.fileKey,
        mimeType: uploaded?.mimeType,
        size: uploaded?.size,
        competenceMonth: body.competenceMonth,
        competenceYear: body.competenceYear,
        status: body.status,
        tags: body.tags,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: currentTenantId,
        userId: userId(req),
        action: 'DOCUMENT_UPLOAD_SUPABASE_STORAGE',
        entity: 'FiscalDocument',
        entityId: document.id,
        metadata: uploaded ? { fileKey: uploaded.fileKey, mimeType: uploaded.mimeType, size: uploaded.size } : undefined,
      },
    });

    res.status(201).json(document);
  } catch (e) {
    next(e);
  }
});

r.get('/documents/:id/download', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'documents');
    await requireVerifiedEmail(req);
    const document = await prisma.fiscalDocument.findFirst({
      where: { id: str(req.params.id), tenantId: tenantId(req), deletedAt: null },
      select: { fileKey: true, fileUrl: true },
    });

    if (!document) throw new AppError('Documento não encontrado', 404);
    if (!document.fileKey && !document.fileUrl) throw new AppError('Documento não possui arquivo vinculado', 404);

    if (document.fileKey) {
      const url = await createSignedDocumentUrl(document.fileKey);
      return res.json({ url, expiresIn: env.SUPABASE_SIGNED_URL_EXPIRES_IN });
    }

    return res.json({ url: document.fileUrl, expiresIn: null });
  } catch (e) {
    next(e);
  }
});

r.patch('/documents/:id', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'documents');
    const body = documentUpdateSchema.parse(req.body);
    const updated = await prisma.fiscalDocument.updateMany({ where: { id: str(req.params.id), tenantId: tenantId(req), deletedAt: null }, data: body });
    if (!updated.count) throw new AppError('Documento não encontrado', 404);
    await audit(req, 'DOCUMENT_UPDATED', 'FiscalDocument', str(req.params.id), { fields: Object.keys(body) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.delete('/documents/:id', requireAuth, requireRole('OWNER', 'ADMIN'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'documents');
    const id = str(req.params.id);
    const updated = await prisma.fiscalDocument.updateMany({ where: { id, tenantId: tenantId(req), deletedAt: null }, data: { deletedAt: new Date(), status: 'REJECTED' } });
    if (!updated.count) throw new AppError('Documento não encontrado', 404);
    await prisma.auditLog.create({ data: { tenantId: tenantId(req), userId: userId(req), action: 'DOCUMENT_SOFT_DELETE', entity: 'FiscalDocument', entityId: id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

r.get('/checklists/current', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'checklist');
    const query = z.object({ month: z.coerce.number().int().min(1).max(12).optional(), year: z.coerce.number().int().min(2020).optional() }).parse(req.query);
    const fallback = currentMonthYear();
    const month = query.month ?? fallback.month;
    const year = query.year ?? fallback.year;
    res.json(await buildAutomaticChecklist(tenantId(req), month, year));
  } catch (e) {
    next(e);
  }
});

r.patch('/checklists/items/:id', requireAuth, writeLimiter, async (req, _res, next) => {
  try {
    await requirePageAccess(req, 'checklist');
    next(new AppError('Checklist automático: conclua a atividade na tela correspondente em vez de marcar manualmente.', 409));
  } catch (e) {
    next(e);
  }
});

r.post('/simulators/mei-vs-simples', requireAuth, async (req, res, next) => {
  try {
    const access = await requirePageAccess(req, 'simulator');
    const body = z
      .object({
        monthlyRevenue: z.coerce.number().nonnegative(),
        currentAnnualRevenue: z.coerce.number().nonnegative().default(0),
        employees: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(req.body);

    const monthIndex = new Date().getUTCMonth();
    const remainingMonthsIncludingCurrent = 12 - monthIndex;
    const projection = body.currentAnnualRevenue + body.monthlyRevenue * remainingMonthsIncludingCurrent;
    const limit = 81_000;
    const percent = Math.round((projection / limit) * 100);
    const warnings: string[] = [];

    if (projection > limit) warnings.push('A projeção passa do limite anual atual usado como referência para MEI.');
    if (percent >= 80 && percent <= 100) warnings.push('A projeção já está na zona de atenção do limite anual.');
    if (body.employees > 1) warnings.push('Quantidade de funcionários informada pode exigir revisão do enquadramento.');

    res.json({
      projection,
      limit,
      percent,
      attention: warnings.length > 0,
      warnings,
      message: warnings.length
        ? 'Separe os números e converse com o contador antes de deixar o problema estourar.'
        : 'Cenário aparentemente controlado para organização, mas valide com contador.',
      disclaimer,
      mode: access.limits.simulator,
      upgradeHint: access.limits.simulator === 'basic' ? 'Plano Pro libera comparação MEI x Simples mais completa.' : null,
    });
  } catch (e) {
    next(e);
  }
});

r.post('/reports/monthly/generate', requireAuth, requireRole('OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'), writeLimiter, async (req, res, next) => {
  try {
    const access = await requirePageAccess(req, 'reports');
    await requireVerifiedEmail(req);
    const body = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020) }).parse(req.body);
    const { start, end } = rangeMonth(body.month, body.year);
    const currentTenantId = tenantId(req);

    const [revenues, expenses, obligations, documents] = await Promise.all([
      prisma.revenue.findMany({ where: { tenantId: currentTenantId, receivedAt: { gte: start, lt: end } } }),
      prisma.expense.findMany({ where: { tenantId: currentTenantId, paidAt: { gte: start, lt: end } } }),
      prisma.taxObligation.findMany({ where: { tenantId: currentTenantId, competenceMonth: body.month, competenceYear: body.year } }),
      prisma.fiscalDocument.findMany({ where: { tenantId: currentTenantId, competenceMonth: body.month, competenceYear: body.year, deletedAt: null } }),
    ]);

    const revenuesTotal = revenues.reduce((acc: number, item: any) => acc + Number(item.amount), 0);
    const expensesTotal = expenses.reduce((acc: number, item: any) => acc + Number(item.amount), 0);
    const summary = {
      revenuesTotal,
      expensesTotal,
      result: revenuesTotal - expensesTotal,
      revenuesCount: revenues.length,
      expensesCount: expenses.length,
      obligationsCount: obligations.length,
      pendingObligationsCount: obligations.filter((item: any) => item.status !== 'PAID').length,
      documentsCount: documents.length,
      disclaimer,
    };

    const exports = access.limits.reports
      ? await uploadReportExports({ tenantId: currentTenantId, month: body.month, year: body.year, summary })
      : { pdfFileKey: null, csvFileKey: null };

    const report = await prisma.fiscalReport.create({
      data: {
        tenantId: currentTenantId,
        month: body.month,
        year: body.year,
        summary,
        generatedBy: userId(req),
        pdfUrl: exports.pdfFileKey,
        excelUrl: exports.csvFileKey,
      },
    });

    await audit(req, 'FISCAL_REPORT_GENERATED', 'FiscalReport', report.id, { month: body.month, year: body.year, exportsGenerated: Boolean(exports.pdfFileKey || exports.csvFileKey) });
    res.status(201).json(report);
  } catch (e) {
    next(e);
  }
});

r.get('/reports', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'reports');
    const query = paginationSchema.parse(req.query);
    const reports = await prisma.fiscalReport.findMany({ where: { tenantId: tenantId(req) }, orderBy: { generatedAt: 'desc' }, take: query.limit, skip: query.offset });
    res.json(reports);
  } catch (e) {
    next(e);
  }
});

r.get('/reports/:id/download/:format', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'reports');
    await requireVerifiedEmail(req);
    const params = z.object({ id: z.string().min(3), format: z.enum(['pdf', 'excel']) }).parse(req.params);
    const report = await prisma.fiscalReport.findFirst({ where: { id: params.id, tenantId: tenantId(req) } });
    if (!report) throw new AppError('Relatório não encontrado.', 404);

    const fileKey = params.format === 'pdf' ? report.pdfUrl : report.excelUrl;
    if (!fileKey) throw new AppError('Arquivo do relatório ainda não foi gerado.', 404);

    const url = fileKey.startsWith('http') ? fileKey : await createSignedDocumentUrl(fileKey);
    res.json({ ok: true, url, expiresIn: env.SUPABASE_SIGNED_URL_EXPIRES_IN, format: params.format });
  } catch (e) {
    next(e);
  }
});

const settingsSchema = z.object({
  tenant: z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      legalName: optionalText,
      cnpj: optionalText,
      city: optionalText,
      state: optionalText,
      phone: optionalText,
      email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
      taxProfile: z.enum(taxRegimes).optional(),
    })
    .optional(),
  profile: z
    .object({
      regime: z.enum(taxRegimes).optional(),
      businessType: z.enum(businessTypes).optional(),
      meiAnnualLimit: z.coerce.number().positive().optional(),
      dasDueDay: z.coerce.number().int().min(1).max(31).optional(),
      hasAccountant: z.coerce.boolean().optional(),
      accountantName: optionalText,
      accountantEmail: z.string().email().optional().or(z.literal('').transform(() => undefined)),
      accountantPhone: optionalText,
      estimatedTaxRate: z.coerce.number().min(0).max(100).optional(),
    })
    .optional(),
});

async function ensureFiscalProfile(currentTenantId: string) {
  return prisma.fiscalProfile.upsert({ where: { tenantId: currentTenantId }, update: {}, create: { tenantId: currentTenantId } });
}

r.get('/settings', requireAuth, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'settings');
    const currentTenantId = tenantId(req);
    const [tenant, profile] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: currentTenantId } }),
      ensureFiscalProfile(currentTenantId),
    ]);

    res.json({ tenant, profile, meta: { taxRegimes: meta.taxRegimes, businessTypes: meta.businessTypes }, disclaimer });
  } catch (e) {
    next(e);
  }
});

r.patch('/settings', requireAuth, requireRole('OWNER', 'ADMIN'), writeLimiter, async (req, res, next) => {
  try {
    await requirePageAccess(req, 'settings');
    const body = settingsSchema.parse(req.body);
    const currentTenantId = tenantId(req);

    await prisma.$transaction(async (tx: any) => {
      if (body.tenant) {
        await tx.tenant.update({ where: { id: currentTenantId }, data: body.tenant });
      }

      if (body.profile) {
        await tx.fiscalProfile.upsert({ where: { tenantId: currentTenantId }, update: body.profile, create: { tenantId: currentTenantId, ...body.profile } });
      }
    });

    const [tenant, profile] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: currentTenantId } }),
      ensureFiscalProfile(currentTenantId),
    ]);

    await audit(req, 'SETTINGS_UPDATED', 'Tenant', currentTenantId, { tenantFields: Object.keys(body.tenant ?? {}), profileFields: Object.keys(body.profile ?? {}) });
    res.json({ ok: true, tenant, profile });
  } catch (e) {
    next(e);
  }
});



r.post('/internal/maintenance/run', async (req, res, next) => {
  try {
    requireNextaxInternalApiKey(req);
    const now = new Date();
    const staleCheckoutDate = new Date(now.getTime() - 1000 * 60 * 60 * 24);
    const oldTokenDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);

    const [expiredTenants, staleCheckouts, refreshTokens, resetTokens, verificationTokens] = await Promise.all([
      prisma.tenant.updateMany({
        where: { deletedAt: null, plan: { not: 'FREE' }, planExpiresAt: { lt: now } },
        data: { plan: 'FREE', planExpiresAt: null, enabledIntegrations: [], integrationAddons: [] },
      }),
      prisma.billingCheckout.updateMany({
        where: { status: { in: ['PENDING', 'IN_PROCESS', 'AUTHORIZED'] }, createdAt: { lt: staleCheckoutDate } },
        data: { status: 'CANCELLED' },
      }),
      prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null, lt: oldTokenDate } }] },
      }),
      prisma.passwordResetToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
      }),
      prisma.emailVerificationToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
      }),
    ]);

    res.json({
      ok: true,
      ranAt: now.toISOString(),
      expiredTenants: expiredTenants.count,
      staleCheckouts: staleCheckouts.count,
      deletedRefreshTokens: refreshTokens.count,
      deletedResetTokens: resetTokens.count,
      deletedVerificationTokens: verificationTokens.count,
    });
  } catch (e) {
    next(e);
  }
});

const deleteAccountSchema = z.object({
  password: z.string().min(1),
  confirmation: z.string().trim(),
});

r.delete('/account', requireAuth, requireRole('OWNER'), writeLimiter, async (req, res, next) => {
  try {
    const body = deleteAccountSchema.parse(req.body);
    if (body.confirmation !== 'EXCLUIR') {
      throw new AppError('Digite EXCLUIR para confirmar a exclusão da conta.', 400);
    }

    const currentUserId = userId(req);
    const currentTenantId = tenantId(req);
    const user = await prisma.user.findUnique({ where: { id: currentUserId } });
    if (!user || user.deletedAt) throw new AppError('Usuário inválido', 401);
    if (!(await bcrypt.compare(body.password, user.passwordHash))) throw new AppError('Senha inválida', 401);

    const tenant = await prisma.tenant.findUnique({ where: { id: currentTenantId }, select: { ownerId: true, name: true, origin: true } });
    if (!tenant || tenant.ownerId !== currentUserId) {
      throw new AppError('Apenas o dono da empresa pode excluir esta conta.', 403);
    }

    if (user.origin === 'NEXCORE' || tenant.origin === 'NEXCORE') {
      throw new AppError('Esta conta é gerenciada pelo NexCore. Faça a exclusão/desativação pelo painel NexCore para manter o ecossistema sincronizado.', 403);
    }

    const documents: Array<{ id: string; fileKey: string | null }> = await prisma.fiscalDocument.findMany({ where: { tenantId: currentTenantId, deletedAt: null }, select: { id: true, fileKey: true } });

    await prisma.$transaction(async (tx: any) => {
      await tx.auditLog.create({ data: { tenantId: currentTenantId, userId: currentUserId, action: 'ACCOUNT_DELETE_REQUESTED', entity: 'Tenant', entityId: currentTenantId } });
      await tx.fiscalDocument.updateMany({ where: { tenantId: currentTenantId, deletedAt: null }, data: { deletedAt: new Date(), status: 'REJECTED' } });
      await tx.refreshToken.updateMany({ where: { userId: currentUserId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.tenant.update({ where: { id: currentTenantId }, data: { deletedAt: new Date() } });
      await tx.user.update({ where: { id: currentUserId }, data: { deletedAt: new Date(), email: `deleted-${currentUserId}@nextax.local` } });
    });

    await Promise.all(documents.filter((document) => document.fileKey).map((document) => deleteFiscalDocument(document.fileKey as string).catch(() => null)));
    await logout(req, res);
    res.json({ ok: true, message: 'Conta excluída e sessão encerrada.' });
  } catch (e) {
    next(e);
  }
});

export default r;
