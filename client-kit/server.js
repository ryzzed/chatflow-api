'use strict';

require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Customisation (set via env vars or edit directly) ──────────────────────────
const CLIENT_NAME = process.env.CLIENT_NAME || 'AI Assistant';
const WELCOME_MESSAGE = process.env.WELCOME_MESSAGE || 'Hi! How can I help you today?';
const ACCENT_COLOR = process.env.ACCENT_COLOR || '#4F46E5';
const MAX_HISTORY_PAIRS = 10; // conversation turns kept in memory per session

// ── Groq client (OpenAI-compatible API) ───────────────────────────────────────
const groq = new OpenAI({
  apiKey: process.env.GROK_API || '',
  baseURL: 'https://api.groq.com/openai/v1',
});
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── Knowledge base ────────────────────────────────────────────────────────────
const knowledgePath = path.join(__dirname, 'knowledge.txt');
const knowledgeBase = fs.existsSync(knowledgePath)
  ? fs.readFileSync(knowledgePath, 'utf8').trim()
  : '';

const SYSTEM_PROMPT = [
  `You are the AI assistant for ${CLIENT_NAME}. Be helpful, friendly, and concise.`,
  `Answer questions accurately. If you don't know something, say so honestly and suggest contacting support.`,
  knowledgeBase
    ? `\n--- Knowledge Base ---\n${knowledgeBase}\n--- End Knowledge Base ---`
    : '',
]
  .join('\n')
  .trim();

// ── In-memory sessions (no database needed) ───────────────────────────────────
// Map<sessionId, Array<{role, content}>>
const sessions = new Map();
const sessionTimestamps = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Prune expired sessions every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, ts] of sessionTimestamps.entries()) {
    if (ts < cutoff) {
      sessions.delete(id);
      sessionTimestamps.delete(id);
    }
  }
}, 30 * 60 * 1000).unref();

// ── Middleware ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// Allow embedding in iframes (override helmet-like defaults)
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages — please slow down.' },
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    client: CLIENT_NAME,
    knowledgeLoaded: knowledgeBase.length > 0,
  });
});

// ── Chat API endpoint ─────────────────────────────────────────────────────────
// POST /api/chat  { message: string, sessionId?: string }
// Returns         { response: string, sessionId: string }
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { message, sessionId } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }

  const sid = sessionId && typeof sessionId === 'string' ? sessionId : crypto.randomUUID();
  const history = sessions.get(sid) || [];

  // Build messages: system prompt + recent history + new user message
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-(MAX_HISTORY_PAIRS * 2)), // keep last N pairs
    { role: 'user', content: message.trim() },
  ];

  let reply;
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    });
    reply = completion.choices[0]?.message?.content || '';
  } catch (err) {
    console.error('Groq API error:', err?.message || err);
    return res
      .status(502)
      .json({ error: 'AI service temporarily unavailable. Please try again.' });
  }

  // Persist to in-memory session
  history.push({ role: 'user', content: message.trim() });
  history.push({ role: 'assistant', content: reply });
  sessions.set(sid, history);
  sessionTimestamps.set(sid, Date.now());

  res.json({ response: reply, sessionId: sid });
});

// ── Chat widget — served as iframe-embeddable page ────────────────────────────
// GET /chat
app.get('/chat', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildWidget());
});

function buildWidget() {
  // All values are server-side rendered — no XSS risk from user input here
  // (CLIENT_NAME / ACCENT_COLOR come from env vars set by us, not end users)
  const safeClientName = CLIENT_NAME.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeWelcome = WELCOME_MESSAGE.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeColor = ACCENT_COLOR.replace(/[^a-zA-Z0-9#()%., ]/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeClientName} Chat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: ${safeColor};
      color: #fff;
      padding: 14px 18px;
      font-weight: 600;
      font-size: 15px;
      flex-shrink: 0;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.bot {
      background: #fff;
      border: 1px solid #e5e7eb;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .msg.user {
      background: ${safeColor};
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .msg.typing { color: #9ca3af; font-style: italic; font-size: 13px; }
    #input-row {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #e5e7eb;
      background: #fff;
      flex-shrink: 0;
    }
    #msg-input {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 14px;
      outline: none;
      resize: none;
      font-family: inherit;
    }
    #msg-input:focus { border-color: ${safeColor}; box-shadow: 0 0 0 2px ${safeColor}22; }
    #send-btn {
      background: ${safeColor};
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 18px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
    }
    #send-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  </style>
</head>
<body>
  <header>${safeClientName}</header>
  <div id="messages">
    <div class="msg bot">${safeWelcome}</div>
  </div>
  <div id="input-row">
    <textarea id="msg-input" rows="1" placeholder="Type your message…"></textarea>
    <button id="send-btn">Send</button>
  </div>
  <script>
    let sessionId = null;
    const msgsEl = document.getElementById('messages');
    const input  = document.getElementById('msg-input');
    const btn    = document.getElementById('send-btn');

    function addMsg(text, cls) {
      const el = document.createElement('div');
      el.className = 'msg ' + cls;
      el.textContent = text;
      msgsEl.appendChild(el);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return el;
    }

    async function send() {
      const text = input.value.trim();
      if (!text || btn.disabled) return;

      input.value = '';
      input.style.height = 'auto';
      btn.disabled = true;

      addMsg(text, 'user');
      const typing = addMsg('Typing…', 'bot typing');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId }),
        });
        const data = await res.json();
        sessionId = data.sessionId || sessionId;
        typing.remove();
        addMsg(data.response || 'Sorry, something went wrong.', 'bot');
      } catch (_) {
        typing.remove();
        addMsg('Network error — please check your connection and try again.', 'bot');
      }

      btn.disabled = false;
      input.focus();
    }

    btn.addEventListener('click', send);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    // Auto-grow textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    input.focus();
  </script>
</body>
</html>`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Client kit server running at http://localhost:${PORT}`);
  console.log(`  Client name : ${CLIENT_NAME}`);
  console.log(`  Chat widget : http://localhost:${PORT}/chat`);
  console.log(`  Health      : http://localhost:${PORT}/health`);
  console.log(`  Knowledge   : ${knowledgeBase.length > 0 ? `loaded (${knowledgeBase.length} chars)` : 'empty'}\n`);
});
