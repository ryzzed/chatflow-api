import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { prisma } from '../db';
import { checkUsageCap, getBotMonthlyUsage, PLAN_CAPS } from '../utils/usage';
import { chatLimiter } from '../middleware/rateLimiter';

// ---------------------------------------------------------------------------
// Fire-and-forget: notify bot owner on first-ever conversation for their bot
// Only fires if RESEND_API_KEY is set. Silently skips otherwise.
// ---------------------------------------------------------------------------
async function notifyFirstVisitor(botId: string, firstMessage: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  try {
    // Check if this is the first conversation for this bot
    const convCount = await prisma.conversation.count({ where: { botId } });
    if (convCount !== 1) return; // Only send on the very first conversation

    // Look up bot + owner email
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { name: true, user: { select: { email: true, name: true } } },
    });
    if (!bot?.user?.email) return;

    const ownerName = bot.user.name ?? 'there';
    const dashUrl = `https://myflow.chat/bots/${botId}/conversations`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ChatFlow <hello@myflow.chat>',
        to: [bot.user.email],
        subject: `🎉 ${bot.name} just received its first message!`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1e293b;">
            <div style="background:#7c3aed;border-radius:12px 12px 0 0;padding:24px;text-align:center;">
              <h1 style="color:#fff;font-size:22px;margin:0;">Your bot is working! 🚀</h1>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:24px;">
              <p style="margin:0 0 16px;">Hi ${ownerName},</p>
              <p style="margin:0 0 16px;"><strong>${bot.name}</strong> just received its first visitor message:</p>
              <div style="background:#fff;border-left:4px solid #7c3aed;border-radius:4px;padding:12px 16px;margin:0 0 20px;color:#475569;font-style:italic;">
                "${firstMessage.length > 200 ? firstMessage.slice(0, 200) + '…' : firstMessage}"
              </div>
              <a href="${dashUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;">View the conversation →</a>
              <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">You're receiving this because you own the <strong>${bot.name}</strong> bot on ChatFlow. <a href="https://myflow.chat" style="color:#7c3aed;">Manage bots</a></p>
            </div>
          </div>
        `,
      }),
    });
  } catch (err) {
    // Non-critical — never block the chat response
    console.warn('First-visitor notification failed (non-critical):', err);
  }
}

const router = Router();

// Groq uses the OpenAI-compatible API — same SDK, different base URL + key
const groq = new OpenAI({
  apiKey: process.env.GROK_API ?? '',
  baseURL: 'https://api.groq.com/openai/v1',
});

const GROQ_MODEL = 'llama-3.3-70b-versatile';

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

  // 1. Load bot (must be active) + owner plan for usagePct calculation
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true },
    select: { id: true, name: true, systemPrompt: true, allowedTopics: true, user: { select: { plan: true } } },
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

  // Build effective system prompt — inject guardrail when allowedTopics is configured
  const effectiveSystemPrompt = bot.allowedTopics.trim()
    ? `You are a customer service assistant for ${bot.name}. Only answer questions related to: ${bot.allowedTopics.trim()}. If asked anything else, politely decline and redirect to your purpose.`
    : bot.systemPrompt;

  const groqMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: effectiveSystemPrompt },
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
  const isNewConversation = conversation.messages.length === 0;
  await prisma.message.createMany({
    data: [
      { conversationId: conversation.id, role: 'user', content: message.trim() },
      { conversationId: conversation.id, role: 'assistant', content: assistantContent },
    ],
  });

  // 7. Fire-and-forget: notify owner on first-ever visitor (does not block response)
  if (isNewConversation) {
    notifyFirstVisitor(botId, message.trim()).catch(() => {/* swallow */});
  }

  // 8. Compute usagePct and include in response when >= 80% so widget can show upgrade nudge
  const monthlyAfter = await getBotMonthlyUsage(botId);
  const cap = PLAN_CAPS[bot.user.plan];
  const usagePct = Math.round((monthlyAfter / cap) * 100);
  res.json({ response: assistantContent, sessionId, ...(usagePct >= 80 && { usagePct }) });
});

export default router;
