import 'dotenv/config';
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

// Security headers
app.use(helmet());

// CORS
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
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Routes
app.use('/auth', authRouter);
app.use('/bots', botsRouter);
app.use('/bots', chatRouter); // POST /bots/:botId/chat (public)
app.use('/webhooks', webhooksRouter);

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
