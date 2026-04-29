-- AlterTable: add Paddle customer/subscription columns to users
-- IF NOT EXISTS makes this idempotent on databases bootstrapped with db push
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "paddleCustomerId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT;
