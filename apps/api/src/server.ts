import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler } from './errors.js';
import { env, webOrigins } from './env.js';
import routes from './routes.js';

const app = express();

app.set('trust proxy', 1);

const productionOrigins = [
  'https://nextax.business',
  'https://www.nextax.business',
  'https://nexcore.business',
  'https://www.nexcore.business',
].map((origin) => origin.replace(/\/$/, ''));

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;

  const normalized = origin.replace(/\/$/, '');
  if (webOrigins.includes(normalized) || productionOrigins.includes(normalized)) return true;

  if (env.NODE_ENV !== 'production') {
    try {
      const hostname = new URL(origin).hostname;
      return ['localhost', '127.0.0.1'].includes(hostname);
    } catch {
      return false;
    }
  }

  return false;
}

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('CORS bloqueado'));
    },
    credentials: true,
  }),
);

app.use(express.json({
  limit: '16mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'tiny'));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'nextax-api', timestamp: new Date().toISOString() });
});

app.use('/', routes);
app.use('/api', routes);
app.use(errorHandler);

const port = Number(process.env.PORT || env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 NexTax API running on port ${port}`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`${signal} received`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
