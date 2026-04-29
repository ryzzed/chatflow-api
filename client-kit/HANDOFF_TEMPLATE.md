# Your AI Chatbot is Live! 🎉

Hi [CLIENT_NAME],

Your AI chatbot has been set up and is ready to embed on your website. Here's everything you need.

---

## Your Chatbot URL

```
https://[YOUR-RENDER-URL].onrender.com/chat
```

You can open this URL in any browser to preview the chatbot.

---

## How to Add the Chatbot to Your Website

Choose the option that matches your platform:

### Option A — Any HTML Website

Paste this code where you want the chatbot to appear on your page:

```html
<iframe
  src="https://[YOUR-RENDER-URL].onrender.com/chat"
  width="400"
  height="600"
  style="border: none; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.12);"
  title="Chat with us"
></iframe>
```

For a floating chat button in the bottom-right corner of every page, add this instead:

```html
<!-- Floating chat bubble — paste before </body> on every page -->
<style>
  #forge-chat-bubble {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
  }
  #forge-chat-bubble button {
    background: [ACCENT_COLOR];
    color: #fff;
    border: none;
    border-radius: 50px;
    padding: 14px 22px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  }
  #forge-chat-iframe {
    display: none;
    position: fixed;
    bottom: 90px;
    right: 24px;
    width: 380px;
    height: 560px;
    border: none;
    border-radius: 16px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
    z-index: 9999;
  }
</style>
<div id="forge-chat-bubble">
  <button onclick="document.getElementById('forge-chat-iframe').style.display = document.getElementById('forge-chat-iframe').style.display === 'block' ? 'none' : 'block'">
    💬 Chat with us
  </button>
</div>
<iframe
  id="forge-chat-iframe"
  src="https://[YOUR-RENDER-URL].onrender.com/chat"
  title="Chat with us"
></iframe>
```

---

### Option B — WordPress

1. Go to **Appearance → Widgets** (or **Appearance → Editor** for block themes)
2. Add a **Custom HTML** block or widget
3. Paste the iframe code from Option A
4. Save and preview your site

Alternatively, for the floating bubble on all pages:
1. Go to **Appearance → Theme File Editor** → select `footer.php`
2. Paste the floating bubble code just before `</body>`
3. Save the file

---

### Option C — Shopify

1. In your Shopify admin, go to **Online Store → Themes → Edit Code**
2. Open `theme.liquid`
3. Paste the floating bubble code just before `</body>`
4. Save — the chatbot will appear on all pages

---

## What the Chatbot Knows

Your chatbot has been trained on:
- Your FAQ and common customer questions
- Your products / services and pricing
- Your business hours and contact information
- Your return / shipping policies

If a customer asks something outside this knowledge base, the chatbot will honestly say it doesn't know and suggest they contact your support team directly.

---

## Usage Notes

- **Response time:** Usually 1–3 seconds. If the server was idle, the first message may take up to 20 seconds (the server is waking up — this is normal).
- **Conversation memory:** The chatbot remembers the conversation for 2 hours per visitor. After that, or on page refresh, it starts fresh.
- **Message limits:** Your plan includes up to 14,400 messages per day (Groq free tier). This is more than enough for most small businesses.

---

## If Something Breaks

1. **Chatbot doesn't load / shows blank** — check that the iframe URL is correct and the service is running at the URL above.
2. **"AI service temporarily unavailable"** — the AI provider (Groq) is experiencing a hiccup. Try again in 30 seconds.
3. **Server sleeping** — the free hosting plan puts the server to sleep after 15 minutes of no traffic. The first visitor wakes it up (takes ~20 seconds). This is normal.

For any issues, email us at: **[FORGEAI_SUPPORT_EMAIL]**

We typically respond within 24 hours on business days.

---

## Want Updates or Changes?

We can update your chatbot's knowledge base, adjust the welcome message, or change the colors at any time.  
Just email us the changes and we'll deploy them within 1–2 business days.

---

*Delivered by ForgeAI — AI automation for growing businesses.*  
*[forgeai.io] — [FORGEAI_SUPPORT_EMAIL]*
