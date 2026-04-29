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

// ── Usage warning emails ───────────────────────────────────────────────────
// Tracks which users received an 80%-quota warning this calendar month.
// Stored in-memory (keyed `userId-YYYY-MM`) — resets on deploy, which is fine.
const usageWarningSent = new Set<string>();

const PLAN_CAPS_WARN: Record<string, number> = { FREE: 800, STARTER: 4000 }; // 80% of 1000/5000

async function checkUsageLimits(): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    // Only check FREE and STARTER — PRO is unlimited
    const users = await prisma.user.findMany({
      where: { plan: { in: ['FREE', 'STARTER'] } },
      select: { id: true, email: true, name: true, plan: true },
    });

    for (const user of users) {
      const warningKey = `${user.id}-${month}`;
      if (usageWarningSent.has(warningKey)) continue;

      const threshold = PLAN_CAPS_WARN[user.plan as string];
      if (!threshold) continue;

      const msgCount = await prisma.message.count({
        where: {
          role: 'user',
          conversation: { bot: { userId: user.id } },
          createdAt: { gte: startOfMonth },
        },
      });

      if (msgCount < threshold) continue;

      const cap = user.plan === 'FREE' ? 1000 : 5000;
      const pct = Math.round((msgCount / cap) * 100);
      const nextPlan = user.plan === 'FREE' ? 'Starter ($39/mo)' : 'Pro ($79/mo)';
      const firstName = user.name?.split(' ')[0] ?? 'there';

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'ChatFlow <hello@myflow.chat>',
          to: [user.email],
          subject: `You've used ${pct}% of your ChatFlow plan this month`,
          html: `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,sans-serif;background:#0a0a0f;color:#e2e8f0;margin:0;padding:40px 20px">
<div style="max-width:520px;margin:0 auto">
  <div style="background:#f59e0b;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
    <span style="color:#fff;font-size:20px">⚠️</span>
  </div>
  <h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 8px">Heads up, ${firstName}</h1>
  <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px">
    You've used <strong style="color:#f59e0b">${msgCount} of ${cap} conversations</strong> (${pct}%) on your ${user.plan} plan this month.
  </p>
  <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px">
    When you reach ${cap}, your chatbot will stop responding to new visitors until next month.<br>
    Upgrading to ${nextPlan} removes this limit.
  </p>
  <a href="https://myflow.chat/dashboard" style="display:inline-block;background:#7c3aed;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:32px">
    Upgrade my plan →
  </a>
  <p style="color:#334155;font-size:12px;line-height:1.6;margin:0">
    Questions? Reply to this email. · <a href="https://myflow.chat" style="color:#475569">myflow.chat</a>
  </p>
</div>
</body></html>`,
        }),
      });

      usageWarningSent.add(warningKey);
      console.log(`Usage warning sent: ${user.email} (${msgCount}/${cap} — ${pct}%)`);
    }
  } catch (err) {
    console.warn('Usage limit check failed (non-critical):', err);
  }
}

async function main() {
  // Start listening first so the Render health check can succeed quickly,
  // then verify the DB connection in the background.
  app.listen(port, '0.0.0.0', () => {
    console.log(`ChatFlow API listening on port ${port}`);
  });

  try {
    await prisma.$connect();
    console.log('Database connected');

    // Run usage limit check every hour — sends upgrade nudge at 80% quota
    setInterval(() => { checkUsageLimits().catch(console.warn); }, 60 * 60 * 1000);
    // Also run once on startup (after a short delay for DB to be ready)
    setTimeout(() => { checkUsageLimits().catch(console.warn); }, 30_000);
  } catch (err) {
    // Log but don't crash — the /health endpoint will surface the DB status.
    // Render will retry health checks and the service stays up for non-DB routes.
    console.error('Database connection failed on startup:', err);
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
