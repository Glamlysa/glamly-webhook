const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const twilio = require("twilio");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

const accountSid = process.env.ACCOUNT_SID;
const authToken  = process.env.AUTH_TOKEN;
const client     = twilio(accountSid, authToken);
const fromNumber = "whatsapp:+966534864736";

const conversations = {};

function getBotReply(message) {
  const msg = message.toLowerCase();
  if (msg.includes("booking") || msg.includes("حجز"))
    return "To check your booking status, please share your booking ID!";
  if (msg.includes("cancel") || msg.includes("إلغاء"))
    return "To cancel a booking, please share your booking ID. Cancellations made 24hrs before are fully refunded.";
  if (msg.includes("price") || msg.includes("سعر") || msg.includes("كم"))
    return "You can browse all service prices in the Glamly app at glamlysa.com";
  if (msg.includes("hello") || msg.includes("hi") || msg.includes("مرحبا") || msg.includes("هلا"))
    return "👋 Welcome to Glamly! Where beauty made ease.\n\nHow can we help you today?\n1. Booking status\n2. Cancel a booking\n3. Prices\n4. Talk to an agent";
  if (msg.includes("agent") || msg.includes("human") || msg.includes("موظف") || msg.includes("4"))
    return "Connecting you to one of our agents. Please wait a moment! 🙏";
  return null;
}

app.post("/webhook", (req, res) => {
  const from    = req.body.From;
  const message = req.body.Body;
  const time    = new Date().toISOString();

  if (!conversations[from]) conversations[from] = { messages: [], status: "bot" };
  conversations[from].messages.push({ from: "customer", message, time });

  const botReply = getBotReply(message);
  if (botReply) {
    conversations[from].messages.push({ from: "bot", message: botReply, time });
    conversations[from].status = "bot";
    client.messages.create({ from: fromNumber, to: from, body: botReply });
  } else {
    conversations[from].status = "pending";
  }

  res.status(200).send("OK");
});

app.get("/conversations", (req, res) => res.json(conversations));

app.post("/reply", async (req, res) => {
  const { to, message } = req.body;
  try {
    await client.messages.create({ from: fromNumber, to: `whatsapp:${to}`, body: message });
    const key = `whatsapp:${to}`;
    if (conversations[key]) {
      conversations[key].messages.push({ from: "agent", message, time: new Date().toISOString() });
      conversations[key].status = "resolved";
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Glamly Support Dashboard</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: sans-serif; background:#f5f5f5; display:flex; height:100vh; }
  .sidebar { width:300px; background:#1E1040; color:white; display:flex; flex-direction:column; }
  .sidebar-header { padding:20px; background:#2D1B6E; }
  .sidebar-header h2 { font-size:18px; color:#E8DEFF; }
  .sidebar-header p { font-size:11px; color:#9F7FEA; margin-top:4px; }
  .conv-list { flex:1; overflow-y:auto; }
  .conv-item { padding:14px 16px; border-bottom:1px solid #2D1B6E; cursor:pointer; transition:background 0.2s; }
  .conv-item:hover { background:#2D1B6E; }
  .conv-item.active { background:#3D2580; }
  .conv-item .number { font-size:13px; font-weight:600; color:#E8DEFF; }
  .conv-item .preview { font-size:11px; color:#9F7FEA; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600; margin-top:4px; }
  .badge.pending { background:#C8A84B; color:#1A0E3D; }
  .badge.bot { background:#1D9E75; color:white; }
  .badge.resolved { background:#534AB7; color:white; }
  .chat-area { flex:1; display:flex; flex-direction:column; }
  .chat-header { padding:16px 20px; background:white; border-bottom:1px solid #eee; display:flex; align-items:center; gap:12px; }
  .chat-header h3 { font-size:15px; color:#1E1040; }
  .chat-header span { font-size:12px; color:#888; }
  .messages { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:10px; }
  .msg { max-width:65%; padding:10px 14px; border-radius:12px; font-size:13px; line-height:1.5; }
  .msg.customer { background:white; border:1px solid #eee; align-self:flex-start; color:#333; border-radius:12px 12px 12px 0; }
  .msg.bot { background:#E8DEFF; align-self:flex-end; color:#26215C; border-radius:12px 12px 0 12px; }
  .msg.agent { background:#2D1B6E; align-self:flex-end; color:white; border-radius:12px 12px 0 12px; }
  .msg .label { font-size:10px; opacity:0.6; margin-bottom:4px; }
  .msg .time { font-size:10px; opacity:0.5; margin-top:4px; text-align:right; }
  .reply-box { padding:16px 20px; background:white; border-top:1px solid #eee; display:flex; gap:10px; }
  .reply-box input { flex:1; padding:10px 14px; border:1px solid #ddd; border-radius:20px; font-size:13px; outline:none; }
  .reply-box input:focus { border-color:#7C5FD4; }
  .reply-box button { padding:10px 20px; background:#2D1B6E; color:white; border:none; border-radius:20px; font-size:13px; cursor:pointer; }
  .reply-box button:hover { background:#3D2580; }
  .empty { flex:1; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:14px; }
  .refresh-btn { margin:12px 16px; padding:8px; background:#2D1B6E; color:#9F7FEA; border:none; border-radius:6px; cursor:pointer; font-size:12px; width:calc(100% - 32px); }
  .refresh-btn:hover { background:#3D2580; }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">
    <h2>Glamly Support</h2>
    <p>Customer conversations</p>
  </div>
  <div class="conv-list" id="convList"></div>
  <button class="refresh-btn" onclick="loadConversations()">Refresh conversations</button>
</div>
<div class="chat-area" id="chatArea">
  <div class="empty">Select a conversation to view messages</div>
</div>
<script>
  let conversations = {};
  let activeNumber = null;

  async function loadConversations() {
    const res = await fetch('/conversations');
    conversations = await res.json();
    const list = document.getElementById('convList');
    list.innerHTML = '';
    for (const [number, data] of Object.entries(conversations)) {
      const last = data.messages[data.messages.length - 1];
      const div = document.createElement('div');
      div.className = 'conv-item' + (number === activeNumber ? ' active' : '');
      div.innerHTML = \`
        <div class="number">\${number.replace('whatsapp:+','')}</div>
        <div class="preview">\${last ? last.message : 'No messages'}</div>
        <span class="badge \${data.status}">\${data.status}</span>
      \`;
      div.onclick = () => openConversation(number);
      list.appendChild(div);
    }
  }

  function openConversation(number) {
    activeNumber = number;
    const data = conversations[number];
    document.getElementById('chatArea').innerHTML = \`
      <div class="chat-header">
        <div>
          <h3>\${number.replace('whatsapp:+','')}</h3>
          <span>Status: \${data.status}</span>
        </div>
      </div>
      <div class="messages" id="messages">
        \${data.messages.map(m => \`
          <div class="msg \${m.from}">
            <div class="label">\${m.from}</div>
            \${m.message}
            <div class="time">\${new Date(m.time).toLocaleTimeString()}</div>
          </div>
        \`).join('')}
      </div>
      <div class="reply-box">
        <input type="text" id="replyInput" placeholder="Type your reply..." onkeydown="if(event.key==='Enter') sendReply()"/>
        <button onclick="sendReply()">Send</button>
      </div>
    \`;
    document.getElementById('messages').scrollTop = 999999;
    loadConversations();
  }

  async function sendReply() {
    const input = document.getElementById('replyInput');
    const message = input.value.trim();
    if (!message || !activeNumber) return;
    const number = activeNumber.replace('whatsapp:+','');
    await fetch('/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: number, message })
    });
    input.value = '';
    await loadConversations();
    openConversation(activeNumber);
  }

  loadConversations();
  setInterval(loadConversations, 10000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, () => console.log("Glamly webhook running on port 3000"));
