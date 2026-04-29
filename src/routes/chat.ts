import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { prisma } from '../db';
import { checkUsageCap } from '../utils/usage';

const router = Router();

// Groq uses the OpenAI-compatible API — same SDK, different base URL + key
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? '',
  baseURL: 'https://api.groq.com/openai/v1',
});

const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Chat rate limiter: 20 req/min per IP per botId
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${req.ip}:${req.params.botId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages, please slow down.' },
});

// POST /bots/:botId/chat  — public, no auth (called by embed widget)
router.post('/:botId/chat', chatLimiter, async (req: Request, res: Response): Promise<void> => {
  const { botId } = req.params;
  const { message, sessionId } = req.body as {
    message?: string;
    sessionId?: string;
  };

  if (!message || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (!sessionId || sessionId.trim().length === 0) {
    res.status(400).json({ error: 'sessionId is required' });
    return;
  }

  // 1. Load bot (must be active)
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true },
    select: { id: true, name: true, systemPrompt: true },
  });

  if (!bot) {
    res.status(404).json({ error: 'Bot not found or inactive' });
    return;
  }

  // 2. Usage cap check
  const usageCheck = await checkUsageCap(botId);
  if (!usageCheck.allowed) {
    const friendly =
      usageCheck.plan === 'FREE'
        ? `This bot has reached its free tier limit (${usageCheck.cap} messages/month). The account owner can upgrade to continue.`
        : `This bot has reached its ${usageCheck.plan.toLowerCase()} plan limit of ${usageCheck.cap} messages/month. The account owner can upgrade to continue.`;
    res.status(429).json({ error: friendly, cap: usageCheck.cap, used: usageCheck.used });
    return;
  }

  // 3. Find or create conversation for this session
  let conversation = await prisma.conversation.findUnique({
    where: { sessionId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 20, // last 20 messages for context window
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { sessionId, botId },
      include: { messages: true },
    });
  } else if (conversation.botId !== botId) {
    // sessionId belongs to a different bot — reject
    res.status(400).json({ error: 'sessionId already in use by a different bot' });
    return;
  }

  // 4. Build messages array for Groq
  const historyMessages = conversation.messages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  const groqMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: bot.systemPrompt },
    ...historyMessages,
    { role: 'user', content: message.trim() },
  ];

  // 5. Call Groq
  let assistantContent: string;
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: groqMessages,
      max_tokens: 1024,
      temperature: 0.7,
    });
    assistantContent = completion.choices[0]?.message?.content ?? '';
  } catch (err) {
    console.error('Groq API error:', err);
    res.status(502).json({ error: 'AI service temporarily unavailable. Please try again.' });
    return;
  }

  // 6. Persist user message + assistant response
  await prisma.message.createMany({
    data: [
      { conversationId: conversation.id, role: 'user', content: message.trim() },
      { conversationId: conversation.id, role: 'assistant', content: assistantContent },
    ],
  });

  res.json({ response: assistantContent, sessionId });
});

export default router;
