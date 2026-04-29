-- AlterTable: add allowedTopics guardrail column to bots
-- IF NOT EXISTS makes this idempotent on databases bootstrapped with db push
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "allowedTopics" TEXT NOT NULL DEFAULT '';
