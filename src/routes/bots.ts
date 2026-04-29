import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { chatLimiter } from '../middleware/rateLimiter';
import { prisma } from '../db';
import type { Plan } from '@prisma/client';

const router = Router();

// Monthly message caps per plan
const PLAN_CAPS: Record<Plan, number> = {
  FREE: 100,
  STARTER: 500,
  PRO: 2000,
};

// Max conversation history turns sent to the model (keeps TPM low on Groq free tier)
const MAX_HISTORY_MESSAGES = 20;

// ─── PUBLIC ROUTES (no auth) ──────────────────────────────────────────────────

// GET /bots/:id/public-config — returns safe config for the embed widget
router.get('/:id/public-config', async (req: Request, res: Response): Promise<void> => {
  const bot = await prisma.bot.findFirst({
    where: { id: req.params.id, isActive: true },
    select: { id: true, name: true, welcomeMessage: true, accentColor: true },
  });

  if (!bot) {
    res.status(404).json({ error: 'Bot not found or inactive' });
    return;
  }

  res.json({ bot });
});

// POST /bots/:botId/chat — called by embed widget end-users
router.post('/:botId/chat', chatLimiter, async (req: Request, res: Response): Promise<void> => {
  const { botId } = req.params;
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (!sessionId || sessionId.trim().length === 0) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  // Load bot + owner plan in one query
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true },
    include: { user: { select: { plan: true } } },
  });

  if (!bot) {
    res.status(404).json({ error: 'Bot not found or inactive' });
    return;
  }

  // ── Usage cap check ──────────────────────────────────────────────────────────
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthlyCount = await prisma.message.count({
    where: {
      role: 'user',
      conversation: { botId },
      createdAt: { gte: startOfMonth },
    },
  });

  const cap = PLAN_CAPS[bot.user.plan];
  if (monthlyCount >= cap) {
    res.status(429).json({
      error: `Monthly message limit of ${cap} reached. Please upgrade your plan to continue.`,
    });
    return;
  }

  // ── Find or create conversation ──────────────────────────────────────────────
  let conversation = await prisma.conversation.findUnique({
    where: { sessionId: sessionId.trim() },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { sessionId: sessionId.trim(), botId },
    });
  } else if (conversation.botId !== botId) {
    res.status(400).json({ error: 'Session belongs to a different bot' });
    return;
  }

  // ── Fetch recent history for context (before storing new message) ────────────
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY_MESSAGES,
  });

  // ── Call Groq via OpenAI-compatible SDK ──────────────────────────────────────
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    res.status(500).json({ error: 'LLM service not configured' });
    return;
  }

  const client = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: groqApiKey,
  });

  let assistantContent: string;
  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: bot.systemPrompt },
        ...history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: message.trim() },
      ],
    });
    assistantContent = completion.choices[0]?.message?.content ?? '';
  } catch (err) {
    console.error('Groq API error:', err);
    res.status(502).json({ error: 'AI service unavailable, please try again' });
    return;
  }

  // ── Persist both messages ────────────────────────────────────────────────────
  await prisma.message.createMany({
    data: [
      { role: 'user', content: message.trim(), conversationId: conversation.id },
      { role: 'assistant', content: assistantContent, conversationId: conversation.id },
    ],
  });

  res.json({ response: assistantContent, sessionId: sessionId.trim() });
});

// ─── PROTECTED ROUTES (require JWT) ──────────────────────────────────────────

router.use(requireAuth);

// POST /bots — create a bot
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { name, welcomeMessage, systemPrompt, accentColor } = req.body as {
    name?: string;
    welcomeMessage?: string;
    systemPrompt?: string;
    accentColor?: string;
  };

  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const bot = await prisma.bot.create({
    data: {
      name: name.trim(),
      welcomeMessage: welcomeMessage?.trim(),
      systemPrompt: systemPrompt?.trim(),
      accentColor: accentColor?.trim(),
      userId,
    },
  });

  res.status(201).json({ bot });
});

// GET /bots — list caller's bots
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const bots = await prisma.bot.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ bots });
});

// GET /bots/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const bot = await prisma.bot.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });

  if (!bot) {
    res.status(404).json({ error: 'Bot not found' });
    return;
  }

  res.json({ bot });
});

// PATCH /bots/:id
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.bot.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });

  if (!existing) {
    res.status(404).json({ error: 'Bot not found' });
    return;
  }

  const { name, welcomeMessage, systemPrompt, accentColor, isActive } = req.body as {
    name?: string;
    welcomeMessage?: string;
    systemPrompt?: string;
    accentColor?: string;
    isActive?: boolean;
  };

  const bot = await prisma.bot.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(welcomeMessage !== undefined && { welcomeMessage: welcomeMessage.trim() }),
      ...(systemPrompt !== undefined && { systemPrompt: systemPrompt.trim() }),
      ...(accentColor !== undefined && { accentColor: accentColor.trim() }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  res.json({ bot });
});

// DELETE /bots/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.bot.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });

  if (!existing) {
    res.status(404).json({ error: 'Bot not found' });
    return;
  }

  await prisma.bot.delete({ where: { id: existing.id } });
  res.status(204).send();
});

export default router;
