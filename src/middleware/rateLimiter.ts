import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// General API rate limiter: 100 req / 15 min per IP
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter limiter for auth endpoints: 10 req / 15 min per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

// Chat endpoint limiter: 20 messages / hour per session (IP fallback)
// sessionId is available in req.body because express.json() runs before this middleware
// on the /bots route mount in index.ts.
export const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req: Request) => {
    const sessionId = (req.body as { sessionId?: string } | undefined)?.sessionId;
    return sessionId
      ? `session:${sessionId}`
      : `ip:${req.ip ?? 'unknown'}:${req.params.botId ?? ''}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const botId = req.params.botId ?? 'unknown';
    const sessionId = (req.body as { sessionId?: string } | undefined)?.sessionId ?? 'unknown';
    console.log(
      JSON.stringify({ event: 'rate_limit', botId, sessionId, timestamp: new Date().toISOString() })
    );
    res.status(429).json({ error: 'Rate limit reached. Please try again later.' });
  },
});
