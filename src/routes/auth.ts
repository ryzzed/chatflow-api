import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { prisma } from '../db';
import { authLimiter } from '../middleware/rateLimiter';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
const expiresIn = process.env.JWT_EXPIRES_IN ?? '7d';

async function sendWelcomeEmail(email: string, name: string | null): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const firstName = name?.split(' ')[0] ?? 'there';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ChatFlow <hello@myflow.chat>',
        to: [email],
        subject: 'Your ChatFlow account is ready — here\'s how to go live in 2 minutes',
        html: `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,sans-serif;background:#0a0a0f;color:#e2e8f0;margin:0;padding:40px 20px">
<div style="max-width:520px;margin:0 auto">
  <div style="background:#7c3aed;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:24px">
    <span style="color:#fff;font-size:20px">💬</span>
  </div>
  <h1 style="font-size:24px;font-weight:800;color:#fff;margin:0 0 8px">Welcome to ChatFlow, ${firstName}!</h1>
  <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px">
    Your account is live. Get your first chatbot running in 3 steps:
  </p>

  <div style="margin-bottom:16px;padding:16px 20px;background:rgba(255,255,255,.04);border-radius:12px;border:1px solid rgba(255,255,255,.08)">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="background:#7c3aed;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">1</div>
      <div>
        <p style="color:#fff;font-weight:600;font-size:14px;margin:0 0 2px">Create your bot</p>
        <p style="color:#64748b;font-size:13px;margin:0">Name it, give it a personality, set allowed topics.</p>
      </div>
    </div>
  </div>

  <div style="margin-bottom:16px;padding:16px 20px;background:rgba(255,255,255,.04);border-radius:12px;border:1px solid rgba(255,255,255,.08)">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="background:#7c3aed;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">2</div>
      <div>
        <p style="color:#fff;font-weight:600;font-size:14px;margin:0 0 2px">Test it live</p>
        <p style="color:#64748b;font-size:13px;margin:0">Chat with your bot in the wizard before going live.</p>
      </div>
    </div>
  </div>

  <div style="margin-bottom:32px;padding:16px 20px;background:rgba(255,255,255,.04);border-radius:12px;border:1px solid rgba(255,255,255,.08)">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="background:#7c3aed;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">3</div>
      <div>
        <p style="color:#fff;font-weight:600;font-size:14px;margin:0 0 2px">Paste the embed code</p>
        <p style="color:#64748b;font-size:13px;margin:0">One script tag before &lt;/body&gt; — works on any website.</p>
      </div>
    </div>
  </div>

  <a href="https://myflow.chat/dashboard" style="display:inline-block;background:#7c3aed;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:32px">
    Open my dashboard →
  </a>

  <p style="color:#334155;font-size:12px;line-height:1.6;margin:0">
    Questions? Reply to this email or visit <a href="https://myflow.chat" style="color:#7c3aed">myflow.chat</a>.<br>
    Free plan: 1 bot, 100 conversations/month. No credit card required.
  </p>
</div>
</body></html>`,
      }),
    });
  } catch (err) {
    console.warn('Welcome email failed (non-critical):', err);
  }
}

// POST /auth/register
router.post('/register', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, password: hashed, name },
    select: { id: true, email: true, name: true, plan: true, createdAt: true },
  });

  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  // Fire-and-forget welcome email
  sendWelcomeEmail(user.email, user.name ?? null).catch(() => {});

  res.status(201).json({ user, token });
});

// POST /auth/login
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  const { password: _pw, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

// GET /auth/me — returns the authenticated user's profile + plan + billing status + monthly usage
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: {
      id:                        true,
      email:                     true,
      name:                      true,
      plan:                      true,
      paddleSubscriptionStatus:  true,
      paddleNextBillDate:        true,
      createdAt:                 true,
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Monthly message count across all user's bots (for usage meter in dashboard)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyMessageCount = await prisma.message.count({
    where: {
      role: 'user',
      conversation: { bot: { userId: req.userId! } },
      createdAt: { gte: startOfMonth },
    },
  });

  res.json({ user, monthlyMessageCount });
});

export default router;
