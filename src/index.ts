import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiLimiter } from './middleware/rateLimiter';
import authRouter from './routes/auth';
import botsRouter from './routes/bots';
import chatRouter from './routes/chat';
import webhooksRouter from './routes/webhooks';
import { prisma } from './db';

const app = express();
const port = parseInt(process.env.PORT ?? '3000', 10);

// Static public files (widget.js, demo.html) — served before Helmet CSP kicks in
const publicDir = path.join(__dirname, '..', 'public');

// GET /widget.js — serve embed script with permissive CORS so any site can load it
app.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min cache
  res.sendFile(path.join(publicDir, 'widget.js'));
});

// GET /demo and GET /demo/:botId — widget demo page (bot ID passed as URL param)
app.get('/demo/:botId?', (req, res) => {
  res.sendFile(path.join(publicDir, 'demo.html'));
});

// === Public embed endpoint: wildcard CORS so any site can call the chat API ===
// MUST be registered BEFORE global CORS — cors() always calls res.end() on OPTIONS
// preflights, so if global cors runs first on /bots paths it will terminate the
// request without setting Access-Control-Allow-Origin for unknown (customer) origins.
app.use(
  '/bots',
  cors({ origin: '*' }),              // allow any site that embeds the widget
  express.json({ limit: '1mb' }),     // parse body before chatRouter handles it
  chatRouter                          // POST /bots/:botId/chat (public)
);

// Security headers
app.use(helmet());

// CORS — dashboard/admin endpoints only
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: true,
  })
);

// Paddle webhook — raw body needed for HMAC signature verification
// Must be registered BEFORE express.json() middleware
app.use(
  '/webhooks/paddle',
  express.raw({ type: 'application/json' }),
  (req, _res, next) => {
    // Attach raw body as string for signature verification
    (req as typeof req & { rawBody: string }).rawBody = req.body.toString('utf8');
    // Parse body to JSON for handler convenience
    req.body = JSON.parse((req as typeof req & { rawBody: string }).rawBody);
    next();
  }
);

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Global rate limiter
app.use(apiLimiter);

// Health check — used by Render to verify the service is up
// Runs a lightweight DB ping so deployment failures surface immediately
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', version: '1.0.0', db: 'connected' });
  } catch (err) {
    console.error('Health check DB ping failed:', err);
    res.status(503).json({ status: 'error', version: '1.0.0', db: 'disconnected' });
  }
});

// Routes
app.use('/auth', authRouter);
app.use('/bots', botsRouter);
app.use('/webhooks', webhooksRouter);

// Internal admin route — upgrade user plan by email (protected by ADMIN_SECRET)
app.post('/admin/set-plan', express.json(), async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const { email, plan } = req.body as { email?: string; plan?: string };
  const validPlans = ['FREE', 'STARTER', 'PRO'];
  if (!email || !plan || !validPlans.includes(plan)) {
    res.status(400).json({ error: 'email and plan (FREE|STARTER|PRO) required' });
    return;
  }
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { plan: plan as 'FREE' | 'STARTER' | 'PRO' },
      select: { id: true, email: true, plan: true },
    });
    res.json({ ok: true, user });
  } catch {
    res.status(404).json({ error: 'User not found' });
  }
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  // Verify DB connection
  await prisma.$connect();
  console.log('Database connected');

  app.listen(port, '0.0.0.0', () => {
    console.log(`ChatFlow API listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
