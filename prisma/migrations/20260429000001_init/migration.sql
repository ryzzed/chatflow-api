-- Initial schema — created with IF NOT EXISTS so it is safe to run
-- against an existing database that was bootstrapped with prisma db push.

-- Enums
DO $$ BEGIN
  CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users table (base columns only — Paddle columns added by later migrations)
CREATE TABLE IF NOT EXISTS "users" (
  "id"        TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "password"  TEXT NOT NULL,
  "name"      TEXT,
  "plan"      "Plan" NOT NULL DEFAULT 'FREE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- Paddle webhook events (idempotency table)
CREATE TABLE IF NOT EXISTS "paddle_webhook_events" (
  "id"          TEXT NOT NULL,
  "eventType"   TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"      TEXT,
  CONSTRAINT "paddle_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Bots table (base columns only — allowedTopics added by migration 000003)
CREATE TABLE IF NOT EXISTS "bots" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "welcomeMessage" TEXT NOT NULL DEFAULT 'Hi! How can I help you?',
  "systemPrompt"   TEXT NOT NULL DEFAULT 'You are a helpful assistant.',
  "accentColor"    TEXT NOT NULL DEFAULT '#6366f1',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "userId"         TEXT NOT NULL,
  CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- Conversations table
CREATE TABLE IF NOT EXISTS "conversations" (
  "id"        TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "botId"     TEXT NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_sessionId_key" ON "conversations"("sessionId");

-- Messages table
CREATE TABLE IF NOT EXISTS "messages" (
  "id"             TEXT NOT NULL,
  "role"           "MessageRole" NOT NULL,
  "content"        TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conversationId" TEXT NOT NULL,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- Foreign key constraints (ADD ... IF NOT EXISTS requires PG 12+)
DO $$ BEGIN
  ALTER TABLE "paddle_webhook_events"
    ADD CONSTRAINT "paddle_webhook_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bots"
    ADD CONSTRAINT "bots_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "messages"
    ADD CONSTRAINT "messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
