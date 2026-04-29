# ChatFlow API

Backend API for ChatFlow — a self-serve AI chatbot platform for SMBs.

**Stack:** Node.js 20 · Express · TypeScript · Prisma · Supabase (PostgreSQL) · JWT (jose)

---

## Local Setup

### Prerequisites

- Node.js 20+
- A Supabase project (free tier at [supabase.com](https://supabase.com))

### 1. Clone and install

```bash
git clone <repo-url>
cd chatflow-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase PostgreSQL connection string |
| `JWT_SECRET` | Yes | 256-bit random string — run `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | No | Token lifetime (default: `7d`) |
| `PORT` | No | HTTP port (default: `3000`; Render injects this automatically) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (default: `*`) |
| `NODE_ENV` | No | `development` or `production` |

**Getting your Supabase `DATABASE_URL`:**

1. Go to [supabase.com](https://supabase.com) → New Project (free, no credit card)
2. Project Settings → Database → Connection string → URI
3. Replace `[YOUR-PASSWORD]` with your database password

### 3. Run database migrations

```bash
npm run prisma:migrate:dev
```

This creates the `users`, `bots`, `conversations`, and `messages` tables.

### 4. Start the dev server

```bash
npm run dev
```

Server starts at `http://localhost:3000`.

---

## API Reference

### Health

```
GET /health
→ { "status": "ok", "version": "1.0.0" }
```

### Auth

#### Register

```
POST /auth/register
Content-Type: application/json

{ "email": "user@example.com", "password": "securepass", "name": "Alice" }

→ 201 { "user": { id, email, name, plan, createdAt }, "token": "..." }
```

#### Login

```
POST /auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "securepass" }

→ 200 { "user": { ... }, "token": "..." }
```

### Bots (all require `Authorization: Bearer <token>`)

#### Create bot

```
POST /bots
{ "name": "Support Bot", "welcomeMessage": "Hi!", "systemPrompt": "You are helpful.", "accentColor": "#6366f1" }
→ 201 { "bot": { ... } }
```

#### List bots

```
GET /bots
→ { "bots": [ ... ] }
```

#### Get bot

```
GET /bots/:id
→ { "bot": { ... } }
```

#### Update bot

```
PATCH /bots/:id
{ "name": "New Name", "isActive": false }
→ { "bot": { ... } }
```

#### Delete bot

```
DELETE /bots/:id
→ 204 No Content
```

#### Public config (for embed widget — no auth)

```
GET /bots/:id/public-config
→ { "bot": { id, name, welcomeMessage, accentColor } }
```

---

## curl Quick Test

```bash
BASE=http://localhost:3000

# Register
TOKEN=$(curl -s -X POST $BASE/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123","name":"Test"}' \
  | jq -r .token)

# Create bot
curl -s -X POST $BASE/bots \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Bot","welcomeMessage":"Hello!","systemPrompt":"You are a helpful assistant."}' | jq .

# List bots
curl -s $BASE/bots -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Render Deploy

### Free tier deploy (development / demos)

> Note: Render free tier sleeps after 15 min inactivity. Upgrade to Starter ($7/mo) before first paying customer.

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install && npm run prisma:generate && npm run build && npm run prisma:migrate`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Add environment variables (from `.env.example`) under **Environment** tab
6. Click **Deploy**

Render will auto-deploy on every push to `main`.

### Environment variables on Render

Set these in the Render dashboard under **Environment**:

- `DATABASE_URL` — your Supabase connection string
- `JWT_SECRET` — run `openssl rand -hex 32` locally and paste the result
- `NODE_ENV` — `production`
- `ALLOWED_ORIGINS` — your dashboard URL (e.g. `https://app.chatflow.io`)

`PORT` is injected automatically by Render — do not set it manually.

---

## Project Structure

```
chatflow-api/
├── prisma/
│   └── schema.prisma       # DB schema (User, Bot, Conversation, Message)
├── src/
│   ├── db.ts               # Prisma client singleton
│   ├── index.ts            # Express app + server bootstrap
│   ├── middleware/
│   │   ├── auth.ts         # JWT requireAuth guard
│   │   └── rateLimiter.ts  # express-rate-limit configs
│   └── routes/
│       ├── auth.ts         # POST /auth/register, POST /auth/login
│       └── bots.ts         # CRUD /bots + public-config
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```
