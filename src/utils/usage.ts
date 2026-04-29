import { prisma } from '../db';
import { Plan } from '@prisma/client';

// Monthly message caps per plan (user messages only — assistant responses don't count)
export const PLAN_CAPS: Record<Plan, number> = {
  FREE: 1000,
  STARTER: 5000,
  PRO: 10000,
};

/**
 * Returns the count of user messages sent to this bot in the current calendar month.
 * Only counts MessageRole.user so assistant responses don't inflate the counter.
 */
export async function getBotMonthlyUsage(botId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await prisma.message.count({
    where: {
      role: 'user',
      createdAt: { gte: monthStart },
      conversation: { botId },
    },
  });

  return result;
}

/**
 * Checks if the bot's owner is within their plan's monthly message cap.
 * Returns { allowed: true } or { allowed: false, cap, used, plan }.
 */
export async function checkUsageCap(botId: string): Promise<
  | { allowed: true }
  | { allowed: false; cap: number; used: number; plan: Plan }
> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { user: { select: { plan: true } } },
  });

  if (!bot) return { allowed: true }; // let the route handle the 404

  const plan = bot.user.plan;
  const cap = PLAN_CAPS[plan];
  const used = await getBotMonthlyUsage(botId);

  if (used >= cap) {
    return { allowed: false, cap, used, plan };
  }

  return { allowed: true };
}
