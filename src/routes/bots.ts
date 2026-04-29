import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';

const router = Router();

// All bot routes require auth
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

// GET /bots/:id/public-config — public endpoint for embed widget (no auth)
router.get('/:id/public-config', async (req: AuthRequest, res: Response): Promise<void> => {
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

export default router;
