-- Migration: add_paddle_billing_fields
-- Adds paddleSubscriptionStatus and paddleNextBillDate to users,
-- and creates the paddle_webhook_events idempotency table.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "paddleSubscriptionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "paddleNextBillDate"        TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "paddle_webhook_events" (
  "id"          TEXT        NOT NULL,
  "eventType"   TEXT        NOT NULL,
  "processedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId"      TEXT,

  CONSTRAINT "paddle_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paddle_webhook_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
);
