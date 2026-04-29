/**
 * ChatFlow embed widget v1.0
 * Usage: <script src="https://chatflow-api.onrender.com/widget.js" data-bot-id="YOUR_BOT_ID"></script>
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────────
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var botId = script.getAttribute('data-bot-id');
  if (!botId) {
    console.error('[ChatFlow] data-bot-id attribute is required');
    return;
  }

  // Derive API base URL from the script src (e.g. https://chatflow-api.onrender.com)
  var scriptSrc = script.src || '';
  var apiBase = scriptSrc.replace(/\/widget\.js.*$/, '');
  if (!apiBase) {
    console.error('[ChatFlow] Could not determine API base URL from script src');
    return;
  }

  // ── Session ID ────────────────────────────────────────────────────────────────
  var SESSION_KEY = 'chatflow_session_' + botId;
  var HISTORY_KEY = 'chatflow_history_' + botId;

  function getSessionId() {
    var sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function loadHistory() {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* storage full — ignore */ }
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var sessionId = getSessionId();
  var history = loadHistory();
  var isOpen = false;
  var botConfig = { name: 'Chat', welcomeMessage: 'Hi! How can I help you?', accentColor: '#6366f1' };
  var isSending = false;

  // ── Styles ────────────────────────────────────────────────────────────────────
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '#cf-widget-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483640;transition:transform .2s,box-shadow .2s;}',
    '#cf-widget-btn:hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(0,0,0,.3);}',
    '#cf-widget-btn svg{width:28px;height:28px;fill:#fff;}',
    '#cf-widget-panel{position:fixed;bottom:92px;right:24px;width:360px;max-height:520px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;z-index:2147483639;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;transition:opacity .2s,transform .2s;}',
    '#cf-widget-panel.cf-hidden{opacity:0;pointer-events:none;transform:translateY(12px);}',
    '#cf-header{display:flex;align-items:center;gap:10px;padding:14px 16px;color:#fff;font-weight:600;font-size:15px;}',
    '#cf-header-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.7);}',
    '#cf-messages{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:200px;}',
    '.cf-msg{max-width:80%;padding:8px 12px;border-radius:12px;word-break:break-word;font-size:14px;}',
    '.cf-msg-bot{align-self:flex-start;background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px;}',
    '.cf-msg-user{align-self:flex-end;color:#fff;border-bottom-right-radius:4px;}',
    '.cf-msg-typing{align-self:flex-start;background:#f1f5f9;color:#64748b;font-style:italic;border-bottom-left-radius:4px;}',
    '#cf-input-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #e2e8f0;}',
    '#cf-input{flex:1;border:1px solid #e2e8f0;border-radius:20px;padding:8px 14px;font-size:14px;outline:none;resize:none;max-height:80px;font-family:inherit;}',
    '#cf-input:focus{border-color:#6366f1;}',
    '#cf-send{border:none;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '#cf-send:disabled{opacity:.5;cursor:default;}',
    '#cf-send svg{width:16px;height:16px;fill:#fff;}',
    '#cf-powered{text-align:center;padding:6px 12px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;}',
    '#cf-powered a{color:#6366f1;text-decoration:none;font-weight:500;}',
    '#cf-powered a:hover{text-decoration:underline;}',
    '@media(max-width:440px){#cf-widget-panel{right:8px;left:8px;width:auto;bottom:88px;}}',
  ].join('');
  document.head.appendChild(styleEl);

  // ── DOM ───────────────────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'cf-widget-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>';

  var panel = document.createElement('div');
  panel.id = 'cf-widget-panel';
  panel.className = 'cf-hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat widget');

  panel.innerHTML = [
    '<div id="cf-header">',
      '<div id="cf-header-dot"></div>',
      '<span id="cf-bot-name">Chat</span>',
    '</div>',
    '<div id="cf-messages" role="log" aria-live="polite"></div>',
    '<div id="cf-input-row">',
      '<textarea id="cf-input" rows="1" placeholder="Type a message..." aria-label="Message input"></textarea>',
      '<button id="cf-send" aria-label="Send message">',
        '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
      '</button>',
    '</div>',
    '<div id="cf-powered">Powered by <a href="https://myflow.chat" target="_blank" rel="noopener">ChatFlow</a></div>',
  ].join('');

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var messagesEl = document.getElementById('cf-messages');
  var inputEl = document.getElementById('cf-input');
  var sendBtn = document.getElementById('cf-send');
  var botNameEl = document.getElementById('cf-bot-name');

  // ── Apply theme color ─────────────────────────────────────────────────────────
  function applyColor(color) {
    var header = document.getElementById('cf-header');
    if (header) header.style.background = color;
    btn.style.background = color;
    sendBtn.style.background = color;
    var input = document.getElementById('cf-input');
    if (input) input.style.setProperty('--cf-accent', color);
    // Override focus border color via inline approach
    styleEl.textContent += '#cf-input:focus{border-color:' + color + ';}';
  }

  // ── Render chat history ───────────────────────────────────────────────────────
  function addMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'cf-msg ' + (role === 'user' ? 'cf-msg-user' : 'cf-msg-bot');
    if (role === 'user') {
      div.style.background = botConfig.accentColor;
    }
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  var nudgeShown = false;
  function addUsageNudge(pct) {
    if (nudgeShown) return; // show once per session
    nudgeShown = true;
    var bar = document.createElement('div');
    bar.style.cssText = 'margin:6px 0 2px;padding:8px 12px;background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.2);border-radius:8px;font-size:11px;color:#ca8a04;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    bar.innerHTML = '<span>⚡ ' + pct + '% of this month\'s quota used</span>'
      + '<a href="https://myflow.chat" target="_blank" rel="noopener" '
      + 'style="color:' + botConfig.accentColor + ';font-weight:600;white-space:nowrap;font-size:11px;text-decoration:none;">Upgrade →</a>';
    messagesEl.appendChild(bar);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addLimitCTA() {
    var div = document.createElement('div');
    div.className = 'cf-msg cf-msg-bot';
    div.innerHTML = '<strong style="display:block;margin-bottom:4px">Monthly message limit reached</strong>'
      + '<span style="font-size:12px;opacity:0.75">This bot has used its quota for this month. '
      + 'The site owner can upgrade at <a href="https://myflow.chat" target="_blank" rel="noopener" '
      + 'style="color:' + botConfig.accentColor + ';font-weight:600">myflow.chat</a>.</span>'
      + '<br><a href="https://myflow.chat" target="_blank" rel="noopener" '
      + 'style="display:inline-flex;align-items:center;gap:5px;margin-top:10px;background:'
      + botConfig.accentColor + ';color:#fff;text-decoration:none;padding:7px 14px;'
      + 'border-radius:6px;font-size:12px;font-weight:600;">Upgrade to continue →</a>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    inputEl.disabled = true;
    inputEl.placeholder = 'Upgrade required…';
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.35';
  }

  function renderHistory() {
    messagesEl.innerHTML = '';
    if (history.length === 0 && botConfig.welcomeMessage) {
      addMessage('bot', botConfig.welcomeMessage);
    } else {
      history.forEach(function (m) { addMessage(m.role, m.text); });
    }
  }

  // ── Open/close ────────────────────────────────────────────────────────────────
  function openPanel() {
    isOpen = true;
    panel.classList.remove('cf-hidden');
    btn.setAttribute('aria-label', 'Close chat');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    renderHistory();
    inputEl.focus();
  }

  function closePanel() {
    isOpen = false;
    panel.classList.add('cf-hidden');
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>';
  }

  btn.addEventListener('click', function () {
    if (isOpen) { closePanel(); } else { openPanel(); }
  });

  // ── Send message ──────────────────────────────────────────────────────────────
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    isSending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    addMessage('user', text);
    history.push({ role: 'user', text: text });
    saveHistory(history);

    // Typing indicator
    var typingEl = document.createElement('div');
    typingEl.className = 'cf-msg cf-msg-typing';
    typingEl.textContent = '…';
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    var payload = JSON.stringify({ message: text, sessionId: sessionId });

    // Show a friendly message if the first response is slow (API cold start)
    var slowTimer = setTimeout(function () {
      if (typingEl.parentNode) {
        typingEl.textContent = 'Still thinking… (waking up, hang on a moment)';
      }
    }, 8000);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', apiBase + '/bots/' + botId + '/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      clearTimeout(slowTimer);
      messagesEl.removeChild(typingEl);
      isSending = false;
      sendBtn.disabled = false;

      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var reply = data.response || 'Sorry, I could not respond.';
          addMessage('bot', reply);
          history.push({ role: 'bot', text: reply });
          saveHistory(history);
          // Soft upgrade nudge when approaching the monthly limit
          if (data.usagePct >= 80) { addUsageNudge(data.usagePct); }
        } catch (e) {
          addMessage('bot', 'Sorry, something went wrong. Please try again.');
        }
      } else if (xhr.status === 429) {
        addLimitCTA();
      } else {
        addMessage('bot', 'Sorry, something went wrong. Please try again.');
      }
    };
    xhr.onerror = function () {
      clearTimeout(slowTimer);
      messagesEl.removeChild(typingEl);
      isSending = false;
      sendBtn.disabled = false;
      addMessage('bot', 'Network error. Please check your connection and try again.');
    };
    xhr.send(payload);
  }

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  // ── Load bot config ───────────────────────────────────────────────────────────
  var configXhr = new XMLHttpRequest();
  configXhr.open('GET', apiBase + '/bots/' + botId + '/public-config', true);
  configXhr.onload = function () {
    if (configXhr.status === 200) {
      try {
        var data = JSON.parse(configXhr.responseText);
        if (data.bot) {
          botConfig = {
            name: data.bot.name || botConfig.name,
            welcomeMessage: data.bot.welcomeMessage || botConfig.welcomeMessage,
            accentColor: data.bot.accentColor || botConfig.accentColor,
            hideBranding: !!data.bot.hideBranding,
          };
          botNameEl.textContent = botConfig.name;
          applyColor(botConfig.accentColor);
          if (botConfig.hideBranding) {
            var poweredEl = document.getElementById('cf-powered');
            if (poweredEl) { poweredEl.style.display = 'none'; }
          }
        }
      } catch (e) { /* use defaults */ }
    }
    // Always show button after config attempt
    btn.style.display = 'flex';
  };
  configXhr.onerror = function () {
    btn.style.display = 'flex';
  };

  // Hide button initially until config loads
  btn.style.display = 'none';
  applyColor(botConfig.accentColor); // apply default color immediately
  btn.style.background = botConfig.accentColor;

  configXhr.send();

})();
