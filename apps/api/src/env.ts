import 'dotenv/config';
import { z } from 'zod';

const optionalEnvString = (min = 1) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().min(min).optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: optionalEnvString(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_DOMAIN: optionalEnvString(1),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  WEB_ORIGINS: optionalEnvString(1),
  API_PUBLIC_URL: z.string().url().default('https://api.nextax.business'),
  RESET_PASSWORD_URL: optionalEnvString(1).pipe(z.string().url().optional()),
  RESEND_API_KEY: optionalEnvString(1),
  EMAIL_FROM: optionalEnvString(3),
  NEXCORE_APP_URL: z.string().url().default('https://www.nexcore.business/app'),
  NEXCORE_API_URL: z.string().url().default('https://api.nexcore.business/api'),
  NEXCORE_PRODUCT_KEY: z.string().min(8).default('dev-product-key'),
  NEXCORE_INTERNAL_API_KEY: z.string().min(8).default('dev-internal-key'),
  NEXTAX_INTERNAL_API_KEY: z.string().min(8).default('dev-nextax-internal-key'),
  NEXFINANCE_APP_URL: z.string().url().default('https://www.nexfinance.business'),
  NEXSTOCK_APP_URL: z.string().url().default('https://www.nexstock.business'),
  NEXCRM_APP_URL: z.string().url().default('https://www.nexcrm.business'),
  SUPABASE_URL: optionalEnvString(1).pipe(z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: optionalEnvString(20),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('nextax-documents'),
  SUPABASE_SIGNED_URL_EXPIRES_IN: z.coerce.number().int().min(60).max(86400).default(600),
  MERCADO_PAGO_ACCESS_TOKEN: optionalEnvString(20),
  MERCADO_PAGO_PUBLIC_KEY: optionalEnvString(10),
  MERCADO_PAGO_WEBHOOK_SECRET: optionalEnvString(8),
  MERCADO_PAGO_SUCCESS_URL: optionalEnvString(1).pipe(z.string().url().optional()),
  MERCADO_PAGO_FAILURE_URL: optionalEnvString(1).pipe(z.string().url().optional()),
  MERCADO_PAGO_PENDING_URL: optionalEnvString(1).pipe(z.string().url().optional()),
  MERCADO_PAGO_STATEMENT_DESCRIPTOR: z.string().trim().min(2).max(22).default('NEXTAX'),
  NEXTAX_PRICE_STARTER: z.coerce.number().positive().default(29.9),
  NEXTAX_PRICE_PRO: z.coerce.number().positive().default(59.9),
  NEXTAX_PRICE_BUSINESS: z.coerce.number().positive().default(129.9),
  NEXTAX_ADDON_NEXFINANCE_PRICE: z.coerce.number().positive().default(19.9),
  NEXTAX_ADDON_NEXSTOCK_PRICE: z.coerce.number().positive().default(29.9),
  NEXTAX_ADDON_NEXCRM_PRICE: z.coerce.number().positive().default(39.9),
});

export const env = schema.parse(process.env);
export const isProduction = env.NODE_ENV === 'production';

export const webOrigins = [env.WEB_ORIGIN, ...(env.WEB_ORIGINS?.split(',') ?? [])]
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

if (isProduction) {
  for (const [key, value] of Object.entries({
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    NEXCORE_PRODUCT_KEY: env.NEXCORE_PRODUCT_KEY,
    NEXCORE_INTERNAL_API_KEY: env.NEXCORE_INTERNAL_API_KEY,
    NEXTAX_INTERNAL_API_KEY: env.NEXTAX_INTERNAL_API_KEY,
  })) {
    if (/troque|change|placeholder|dev|secret/i.test(value)) {
      throw new Error(`${key} fraco para produção`);
    }
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em produção para upload de documentos.');
  }

  if (env.MERCADO_PAGO_ACCESS_TOKEN && !env.MERCADO_PAGO_WEBHOOK_SECRET) {
    throw new Error('MERCADO_PAGO_WEBHOOK_SECRET é obrigatório em produção quando MERCADO_PAGO_ACCESS_TOKEN estiver configurado.');
  }

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('RESEND_API_KEY e EMAIL_FROM são obrigatórios em produção para verificação de e-mail e recuperação de senha.');
  }
}
