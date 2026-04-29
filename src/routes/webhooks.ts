import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import type { Plan } from '@prisma/client';

const router = Router();

// ---------------------------------------------------------------------------
// Signature verification
// Paddle signs with HMAC-SHA256: "ts=<timestamp>;h1=<hex>"
// ---------------------------------------------------------------------------
function verifyPaddleSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(';').map((part) => part.split('=') as [string, string])
  );

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}:${rawBody}`)
    .digest('hex');

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Resolve plan from price ID (primary) then product ID (fallback)
// ---------------------------------------------------------------------------
function planFromPaddle(priceId: string | undefined, productId: string | undefined): Plan | null {
  const starterPriceId   = process.env.PADDLE_STARTER_PRICE_ID   ?? '';
  const proPriceId       = process.env.PADDLE_PRO_PRICE_ID       ?? '';
  const starterProductId = process.env.PADDLE_STARTER_PRODUCT_ID ?? '';
  const proProductId     = process.env.PADDLE_PRO_PRODUCT_ID     ?? '';

  if (priceId   && proPriceId       && priceId   === proPriceId)       return 'PRO';
  if (priceId   && starterPriceId   && priceId   === starterPriceId)   return 'STARTER';
  if (productId && proProductId     && productId === proProductId)     return 'PRO';
  if (productId && starterProductId && productId === starterProductId) return 'STARTER';
  return null;
}

// ---------------------------------------------------------------------------
// POST /webhooks/paddle
// Raw body parsing is set up in index.ts; we attach rawBody there.
// ---------------------------------------------------------------------------
router.post('/paddle', async (req: Request, res: Response): Promise<void> => {
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('PADDLE_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Webhook not configured' });
    return;
  }

  const signatureHeader = req.headers['paddle-signature'] as string | undefined;
  if (!signatureHeader) {
    res.status(400).json({ error: 'Missing Paddle-Signature header' });
    return;
  }

  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';

  if (!verifyPaddleSignature(rawBody, signatureHeader, webhookSecret)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  // Paddle event envelope
  const event = req.body as {
    event_id?: string;
    event_type?: string;
    data?: {
      id?: string;                 // subscription ID
      customer_id?: string;
      status?: string;             // "active" | "past_due" | "paused" | "cancelled" | "trialing"
      next_billed_at?: string;     // ISO timestamp
      items?: Array<{ price?: { id?: string; product_id?: string } }>;
      customer?: { email?: string };
      // transaction.payment_failed uses subscription_id
      subscription_id?: string;
    };
  };

  const eventId   = event.event_id;
  const eventType = event.event_type;
  const data      = event.data;

  console.log(`Paddle webhook received: ${eventType} (id: ${eventId})`);

  // ---------------------------------------------------------------------------
  // Idempotency — skip already-processed events (safe to replay)
  // ---------------------------------------------------------------------------
  if (eventId) {
    const existing = await prisma.paddleWebhookEvent.findUnique({ where: { id: eventId } });
    if (existing) {
      console.log(`Paddle webhook: duplicate event ${eventId}, skipping`);
      res.json({ received: true, duplicate: true });
      return;
    }
  }

  try {
    switch (eventType) {
      // -----------------------------------------------------------------------
      // Subscription created or updated: activate/update user plan
      // -----------------------------------------------------------------------
      case 'subscription.created':
      case 'subscription.updated': {
        const customerId     = data?.customer_id;
        const subscriptionId = data?.id;
        const priceId        = data?.items?.[0]?.price?.id;
        const productId      = data?.items?.[0]?.price?.product_id;
        const customerEmail  = data?.customer?.email;
        const subStatus      = data?.status ?? 'active';
        const nextBillDate   = data?.next_billed_at ? new Date(data.next_billed_at) : null;
        const plan           = planFromPaddle(priceId, productId);

        if (!customerId) {
          console.warn('Paddle webhook: missing customer_id');
          break;
        }

        // Resolve user: first by Paddle customer ID, then by email (first purchase)
        let user = await prisma.user.findFirst({ where: { paddleCustomerId: customerId } });
        if (!user && customerEmail) {
          user = await prisma.user.findFirst({ where: { email: customerEmail } });
        }

        if (!user) {
          console.warn(`Paddle webhook: no user found for customer ${customerId} / ${customerEmail}`);
          break;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            plan:                       plan ?? user.plan,
            paddleCustomerId:           customerId,
            paddleSubscriptionId:       subscriptionId,
            paddleSubscriptionStatus:   subStatus,
            paddleNextBillDate:         nextBillDate,
          },
        });

        // Record event for idempotency
        if (eventId) {
          await prisma.paddleWebhookEvent.create({
            data: { id: eventId, eventType: eventType!, userId: user.id },
          });
        }

        console.log(
          `Updated user ${user.id} → plan=${plan ?? user.plan}, status=${subStatus}, nextBill=${nextBillDate?.toISOString() ?? 'n/a'}`
        );
        break;
      }

      // -----------------------------------------------------------------------
      // Subscription paused (e.g. Dunning pause before hard cancel)
      // -----------------------------------------------------------------------
      case 'subscription.paused': {
        const customerId = data?.customer_id;
        if (!customerId) break;

        const user = await prisma.user.findFirst({ where: { paddleCustomerId: customerId } });
        if (!user) break;

        await prisma.user.update({
          where: { id: user.id },
          data: { paddleSubscriptionStatus: 'paused' },
        });

        if (eventId) {
          await prisma.paddleWebhookEvent.create({
            data: { id: eventId, eventType: eventType!, userId: user.id },
          });
        }

        console.log(`User ${user.id} subscription paused`);
        break;
      }

      // -----------------------------------------------------------------------
      // Subscription cancelled: downgrade to FREE
      // -----------------------------------------------------------------------
      case 'subscription.cancelled': {
        const customerId = data?.customer_id;
        if (!customerId) break;

        const user = await prisma.user.findFirst({ where: { paddleCustomerId: customerId } });
        if (!user) break;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            plan:                     'FREE',
            paddleSubscriptionId:     null,
            paddleSubscriptionStatus: 'cancelled',
            paddleNextBillDate:       null,
          },
        });

        if (eventId) {
          await prisma.paddleWebhookEvent.create({
            data: { id: eventId, eventType: eventType!, userId: user.id },
          });
        }

        console.log(`Downgraded user ${user.id} to FREE (subscription cancelled)`);
        break;
      }

      // -----------------------------------------------------------------------
      // Payment failed: mark subscription past_due (plan remains active until
      // Paddle cancels it; user sees a warning banner)
      // -----------------------------------------------------------------------
      case 'transaction.payment_failed': {
        // Paddle sends this on the transaction level; subscription ID is nested
        const subscriptionId = data?.subscription_id ?? data?.id;
        if (!subscriptionId) break;

        const user = await prisma.user.findFirst({ where: { paddleSubscriptionId: subscriptionId } });
        if (!user) break;

        await prisma.user.update({
          where: { id: user.id },
          data: { paddleSubscriptionStatus: 'past_due' },
        });

        if (eventId) {
          await prisma.paddleWebhookEvent.create({
            data: { id: eventId, eventType: eventType!, userId: user.id },
          });
        }

        console.log(`User ${user.id} payment failed — marked past_due`);
        break;
      }

      default:
        // Acknowledge all other event types silently so Paddle doesn't retry
        if (eventId) {
          await prisma.paddleWebhookEvent.create({
            data: { id: eventId, eventType: eventType ?? 'unknown' },
          }).catch(() => {/* ignore dup-key on unhandled events */});
        }
        break;
    }
  } catch (err) {
    console.error('Paddle webhook processing error:', err);
    // Return 500 so Paddle retries — but only if we haven't written the idempotency
    // record yet (otherwise it's safe to return 200 on the retry path above).
    res.status(500).json({ error: 'Webhook processing failed' });
    return;
  }

  // Always return 200 after successful processing so Paddle stops retrying
  res.json({ received: true });
});

export default router;
