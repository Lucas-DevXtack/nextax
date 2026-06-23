import crypto from 'node:crypto';
import { env, isProduction } from './env.js';
import { AppError } from './errors.js';

export const MAX_DOCUMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/xml',
  'text/xml',
  'text/csv',
  'text/plain',
  'application/json',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

const extensionByMimeType: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const mimeTypeByExtension: Record<string, string> = Object.fromEntries(
  Object.entries(extensionByMimeType).map(([mimeType, extension]) => [extension, mimeType]),
);

let bucketReady: Promise<void> | null = null;

function requireStorageEnv() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError('Supabase Storage não configurado. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na API.', 500);
  }

  return {
    url: env.SUPABASE_URL.replace(/\/+$/, ''),
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.SUPABASE_STORAGE_BUCKET,
  };
}

function storageHeaders(extra?: HeadersInit): HeadersInit {
  const { key } = requireStorageEnv();
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    ...extra,
  };
}

function objectPath(fileKey: string) {
  return fileKey
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function sanitizeFileName(name: string) {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);

  return clean || 'documento';
}

function extensionFromName(name: string) {
  const match = sanitizeFileName(name).match(/\.([a-zA-Z0-9]{1,8})$/);
  return match?.[1]?.toLowerCase();
}

export function normalizeDocumentMimeType(originalName: string, mimeType?: string) {
  const cleanMimeType = mimeType?.trim().toLowerCase();
  if (cleanMimeType && cleanMimeType !== 'application/octet-stream') return cleanMimeType;

  const extension = extensionFromName(originalName || '');
  return extension ? mimeTypeByExtension[extension] || cleanMimeType || 'application/octet-stream' : cleanMimeType || 'application/octet-stream';
}

export function assertDocumentFile(input: { mimeType: string; size: number }) {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(input.mimeType as any)) {
    throw new AppError('Tipo de arquivo não permitido. Envie PDF, imagem, XML, CSV, TXT, JSON ou planilha.', 400);
  }

  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
    throw new AppError('Arquivo inválido ou maior que 10 MB.', 400);
  }
}

function startsWithBytes(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function looksLikeUtf8Text(buffer: Buffer) {
  try {
    const decoded = buffer.toString('utf8');
    return !decoded.includes('\uFFFD') && !/[\x00-\x08\x0E-\x1F]/.test(decoded);
  } catch {
    return false;
  }
}

function assertDocumentBuffer(input: { mimeType: string; buffer: Buffer }) {
  const { mimeType, buffer } = input;

  if (mimeType === 'application/pdf' && !startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46])) {
    throw new AppError('Arquivo PDF inválido ou corrompido.', 400);
  }

  if (mimeType === 'image/png' && !startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw new AppError('Arquivo PNG inválido ou corrompido.', 400);
  }

  if (mimeType === 'image/jpeg' && !startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    throw new AppError('Arquivo JPEG inválido ou corrompido.', 400);
  }

  if (mimeType === 'image/webp') {
    const isWebp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
    if (!isWebp) throw new AppError('Arquivo WEBP inválido ou corrompido.', 400);
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && !startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    throw new AppError('Planilha XLSX inválida ou corrompida.', 400);
  }

  if (mimeType === 'application/vnd.ms-excel' && !startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new AppError('Planilha XLS inválida ou corrompida.', 400);
  }

  if (['application/xml', 'text/xml', 'text/csv', 'text/plain', 'application/json'].includes(mimeType) && !looksLikeUtf8Text(buffer)) {
    throw new AppError('Arquivo de texto inválido ou com codificação não suportada.', 400);
  }
}

export function decodeBase64File(input: { base64: string; size: number; mimeType: string }) {
  assertDocumentFile({ mimeType: input.mimeType, size: input.size });

  const cleanBase64 = (input.base64.includes(',') ? input.base64.split(',').pop() || '' : input.base64).replace(/\s/g, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  if (!buffer.length || buffer.length !== input.size) {
    throw new AppError('Arquivo corrompido ou tamanho inconsistente.', 400);
  }

  assertDocumentBuffer({ mimeType: input.mimeType, buffer });

  return buffer;
}

async function ensurePrivateBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { url, bucket } = requireStorageEnv();
      const response = await fetch(`${url}/storage/v1/bucket`, {
        method: 'POST',
        headers: storageHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false,
          file_size_limit: MAX_DOCUMENT_FILE_SIZE_BYTES,
          allowed_mime_types: [...ALLOWED_DOCUMENT_MIME_TYPES],
        }),
      });

      const detail = await response.text().catch(() => '');
      if (response.ok || response.status === 409 || /exists|already|duplicate|ja existe/i.test(detail)) return;

      throw new AppError(`Não foi possível preparar o bucket do Supabase Storage. ${detail}`.trim(), 502);
    })();
  }

  try {
    return await bucketReady;
  } catch (error) {
    bucketReady = null;
    throw error;
  }
}

export async function uploadFiscalDocument(input: { tenantId: string; originalName: string; mimeType: string; buffer: Buffer }) {
  const { url, bucket } = requireStorageEnv();
  assertDocumentFile({ mimeType: input.mimeType, size: input.buffer.length });
  assertDocumentBuffer({ mimeType: input.mimeType, buffer: input.buffer });
  await ensurePrivateBucket();

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeName = sanitizeFileName(input.originalName);
  const ext = extensionByMimeType[input.mimeType] || 'bin';
  const baseName = safeName.replace(/\.[a-zA-Z0-9]{1,8}$/, '') || 'documento';
  const fileKey = `${input.tenantId}/${year}/${month}/${crypto.randomUUID()}-${baseName}.${ext}`;

  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath(fileKey)}`, {
    method: 'PUT',
    headers: storageHeaders({
      'content-type': input.mimeType,
      'cache-control': '3600',
      'x-upsert': 'false',
    }),
    body: input.buffer as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError(`Falha ao enviar arquivo para o Supabase Storage. ${detail}`.trim(), 502);
  }

  return { fileKey, mimeType: input.mimeType, size: input.buffer.length };
}

export async function createSignedDocumentUrl(fileKey: string) {
  const { url, bucket } = requireStorageEnv();
  const response = await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectPath(fileKey)}`, {
    method: 'POST',
    headers: storageHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ expiresIn: env.SUPABASE_SIGNED_URL_EXPIRES_IN }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AppError(`Falha ao gerar link seguro do documento. ${detail}`.trim(), 502);
  }

  const data = (await response.json()) as { signedURL?: string; signedUrl?: string };
  const signedPath = data.signedURL || data.signedUrl;
  if (!signedPath) throw new AppError('Supabase não retornou URL assinada.', 502);

  return signedPath.startsWith('http') ? signedPath : `${url}${signedPath}`;
}

export async function deleteFiscalDocument(fileKey: string) {
  const { url, bucket } = requireStorageEnv();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath(fileKey)}`, {
    method: 'DELETE',
    headers: storageHeaders(),
  });

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '');
    throw new AppError(`Falha ao remover arquivo do Supabase Storage. ${detail}`.trim(), 502);
  }

  return { ok: true };
}

export function validateStorageProductionConfig() {
  if (!isProduction) return;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em produção para upload de documentos.');
  }
}
