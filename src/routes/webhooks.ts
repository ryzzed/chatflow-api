import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import type { Plan } from '@prisma/client';

const router = Router();

// Paddle sends the raw body as-is; we verify using HMAC-SHA256
// Secret is set in Paddle dashboard → Notifications → Webhook secret key
function verifyPaddleSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  // Paddle signature format: "ts=<timestamp>;h1=<hmac>"
  const parts = Object.fromEntries(
    signatureHeader.split(';').map((part) => part.split('=') as [string, string])
  );

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const payload = `${ts}:${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
}

function planFromPaddleProductId(productId: string | undefined): Plan | null {
  const starterProductId = process.env.PADDLE_STARTER_PRODUCT_ID ?? '';
  const proProductId = process.env.PADDLE_PRO_PRODUCT_ID ?? '';

  if (productId === proProductId) return 'PRO';
  if (productId === starterProductId) return 'STARTER';
  return null;
}

// POST /webhooks/paddle
// Paddle sends webhook events here. We handle subscription lifecycle events.
// Raw body parsing is required for signature verification — registered in index.ts
router.post('/', async (req: Request, res: Response): Promise<void> => {
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

  // rawBody is attached by express.raw() middleware in index.ts
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';

  if (!verifyPaddleSignature(rawBody, signatureHeader, webhookSecret)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const event = req.body as {
    event_type?: string;
    data?: {
      customer_id?: string;
      id?: string; // subscription id
      items?: Array<{ price?: { product_id?: string } }>;
      customer?: { email?: string };
    };
  };

  const eventType = event.event_type;
  const data = event.data;

  console.log(`Paddle webhook received: ${eventType}`);

  try {
    switch (eventType) {
      case 'subscription.created':
      case 'subscription.updated': {
        const customerId = data?.customer_id;
        const subscriptionId = data?.id;
        const productId = data?.items?.[0]?.price?.product_id;
        const customerEmail = data?.customer?.email;
        const plan = planFromPaddleProductId(productId);

        if (!customerId) {
          console.warn('Paddle webhook: missing customer_id');
          break;
        }

        // Find user: first by Paddle customer ID (repeat subscriber),
        // then by email (first-time checkout — paddleCustomerId not yet stored)
        let user = await prisma.user.findFirst({
          where: { paddleCustomerId: customerId },
        });

        if (!user && customerEmail) {
          user = await prisma.user.findFirst({
            where: { email: customerEmail },
          });
        }

        if (!user) {
          console.warn(`Paddle webhook: no user found for customer ${customerId} / ${customerEmail}`);
          break;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            plan: plan ?? user.plan,
            paddleCustomerId: customerId,   // store on first purchase
            paddleSubscriptionId: subscriptionId,
          },
        });

        console.log(`Updated user ${user.id} to plan ${plan} (sub: ${subscriptionId})`);
        break;
      }

      case 'subscription.cancelled': {
        const customerId = data?.customer_id;
        if (!customerId) break;

        const user = await prisma.user.findFirst({
          where: { paddleCustomerId: customerId },
        });

        if (!user) break;

        await prisma.user.update({
          where: { id: user.id },
          data: { plan: 'FREE', paddleSubscriptionId: null },
        });

        console.log(`Downgraded user ${user.id} to FREE (subscription cancelled)`);
        break;
      }

      default:
        // Acknowledge unhandled event types silently
        break;
    }
  } catch (err) {
    console.error('Paddle webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
    return;
  }

  // Always return 200 so Paddle doesn't retry
  res.json({ received: true });
});

export default router;
