# ForgeAI Client Kit — Chatbot Delivery Tool

A standalone, single-file chatbot server for the ForgeAI **$499 AI chatbot service**.  
No database. No build step. Deploys to Render free tier in under 15 minutes.

---

## CTO Setup Checklist (run once per new client project)

### Step 1 — Gather client info (before you start)
- [ ] Client business name
- [ ] Brand/accent color (hex code)
- [ ] Welcome message text
- [ ] FAQ document or product info (paste into `knowledge.txt`)
- [ ] Their website URL (for embed instructions)

### Step 2 — Fork the kit
```bash
# Option A: copy the folder into a fresh repo per client
cp -r chatflow-api/client-kit/ ~/projects/client-acme
cd ~/projects/client-acme
git init && git add . && git commit -m "init: acme store chatbot"
# Push to a new GitHub repo named e.g. chatflow-client-acme
```

### Step 3 — Customise for the client
1. **Edit `knowledge.txt`** — replace the template with the client's actual FAQ, product info, hours, policies, etc.
2. **Edit `render.yaml`** — update `name`, `CLIENT_NAME`, `WELCOME_MESSAGE`, `ACCENT_COLOR`

```yaml
# render.yaml
services:
  - name: chatflow-client-acme   # unique name per client
    envVars:
      - key: CLIENT_NAME
        value: Acme Store
      - key: WELCOME_MESSAGE
        value: Hi! I'm Acme's assistant. How can I help?
      - key: ACCENT_COLOR
        value: "#E84B3A"          # client brand color
```

### Step 4 — Get a Groq API key (free)
1. Go to https://console.groq.com/ — sign up / log in
2. **API Keys** → **Create API Key**
3. Copy the key (starts with `gsk_...`)
4. Keep it — you'll paste it into Render in Step 5

### Step 5 — Deploy to Render
1. Push the client repo to GitHub
2. Go to https://render.com/ → **New** → **Web Service** → connect the GitHub repo
3. Render auto-detects `render.yaml` — click **Deploy**
4. In **Environment** tab → add `GROK_API = gsk_...`
5. Wait ~2 min for first deploy

> **Render free tier limit:** 5 concurrent free web services per account.  
> Keep a spreadsheet of which services are in use. Spin down idle projects.

### Step 6 — Test
```bash
# Test health
curl https://chatflow-client-acme.onrender.com/health

# Test chat API
curl -X POST https://chatflow-client-acme.onrender.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are your business hours?"}'

# Open widget in browser
open https://chatflow-client-acme.onrender.com/chat
```

Check:
- [ ] `/health` returns `{ "status": "ok" }`
- [ ] `/api/chat` returns a relevant AI response
- [ ] `/chat` renders correctly with the right color and welcome message
- [ ] Iframe embed works on a test page

### Step 7 — Hand off to client
Use `HANDOFF_TEMPLATE.md` — fill in the Render URL and send it to the client.

---

## Local Development

```bash
# 1. Install dependencies
cd chatflow-api/client-kit
npm install

# 2. Create .env (never commit this)
cp .env.example .env
# Edit .env — add your GROK_API and customise CLIENT_NAME etc.

# 3. Edit knowledge.txt with sample content

# 4. Start server
npm start
# or, with auto-restart:
npm run dev

# 5. Open http://localhost:3000/chat in your browser
```

---

## Architecture

| Component | Description |
|-----------|-------------|
| `server.js` | Single-file Express server — chat API + widget UI |
| `knowledge.txt` | Client FAQ / product info loaded at startup |
| `.env` | Secrets + per-client config (not committed) |
| `render.yaml` | Render deployment config |

**No database.** Conversations are stored in memory per session (2-hour TTL).  
Sessions are lost on Render restart — this is acceptable for a simple chatbot.

**Rate limiting:** 30 requests/minute per IP to protect Groq free tier.

**Groq model:** `llama-3.3-70b-versatile` — fast, capable, free tier.

---

## Embed Snippet for Clients

```html
<!-- Full iframe embed -->
<iframe
  src="https://chatflow-client-acme.onrender.com/chat"
  width="400"
  height="600"
  style="border: none; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.12);"
  title="Chat with us"
></iframe>
```

For floating chat bubble, see `HANDOFF_TEMPLATE.md`.

---

## Cost Per Client Project

| Item | Cost |
|------|------|
| Groq free tier | $0 (14,400 req/day limit) |
| Render free tier | $0 (spins down after 15 min idle) |
| **Total** | **$0/month** |

Note: Render free tier sleeps after 15 min of inactivity. First request after sleep takes ~20s.  
If client needs always-on, upgrade Render to $7/month Starter (get CEO approval first).
