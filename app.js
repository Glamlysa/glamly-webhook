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
  const msg = message.toLowerCase().trim();

  if (msg === "1" || msg.includes("booking") || msg.includes("status") || msg.includes("حجز") || msg.includes("حالة"))
    return "📋 Please share your booking ID and we will check it for you right away!\n\nأرسل رقم حجزك وسنتحقق منه فوراً!";

  if (msg === "2" || msg.includes("cancel") || msg.includes("إلغاء") || msg.includes("الغ"))
    return "❌ To cancel your booking please share your booking ID.\n\nCancellations made 24hrs before the appointment are fully refunded.\n\nلإلغاء حجزك، أرسل رقم الحجز.\nالإلغاء قبل 24 ساعة يحصل على استرداد كامل.";

  if (msg === "3" || msg.includes("price") || msg.includes("cost") || msg.includes("سعر") || msg.includes("كم") || msg.includes("تكلفة"))
    return "💰 You can browse all service prices in the Glamly app!\n\nDownload: glamlysa.com\n\nيمكنك الاطلاع على جميع الأسعار في تطبيق Glamly!\nحمّل التطبيق: glamlysa.com";

  if (msg === "4" || msg.includes("agent") || msg.includes("human") || msg.includes("help") || msg.includes("موظف") || msg.includes("مساعدة") || msg.includes("تواصل"))
    return "👩‍💼 Connecting you to one of our agents now. Please wait a moment!\n\nجاري تحويلك لأحد موظفينا. لحظة من فضلك!";

  if (msg.includes("hello") || msg.includes("hi") || msg.includes("hey") || msg.includes("مرحبا") || msg.includes("هلا") || msg.includes("السلام") || msg.includes("اهلا"))
    return "👋 Welcome to Glamly — where beauty made ease!\nأهلاً بك في Glamly — حيث يصبح الجمال أمراً سهلاً!\n\nHow can we help you today? كيف نساعدك؟\n\n1️⃣ Booking status · حالة الحجز\n2️⃣ Cancel booking · إلغاء الحجز\n3️⃣ Prices · الأسعار\n4️⃣ Talk to agent · التحدث مع موظف";

  if (msg.includes("thank") || msg.includes("شكر") || msg.includes("شكراً"))
    return "🌸 You're most welcome! We're happy to help.\nعلى الرحب والسعة! يسعدنا خدمتك دائماً.\n\nGlamly — where beauty made ease 💜";

  return null;
}

// ── Webhook ──────────────────────────────────────────────────────
app.post("/webhook", (req, res) => {
  const from    = req.body.From;
  const message = req.body.Body;
  const time    = new Date().toISOString();

  if (!conversations[from]) {
    conversations[from] = { messages: [], status: "bot", assignedTo: null, lastSeen: time };
  }

  conversations[from].messages.push({ from: "customer", message, time });
  conversations[from].lastSeen = time;

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

// ── API: get all conversations ───────────────────────────────────
app.get("/conversations", (req, res) => res.json(conversations));

// ── API: agent reply ─────────────────────────────────────────────
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

// ── API: update status ───────────────────────────────────────────
app.post("/status", (req, res) => {
  const { number, status } = req.body;
  if (conversations[number]) {
    conversations[number].status = status;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// ── Dashboard ────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Glamly Support Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:sans-serif;background:#f0eef8;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .topbar{background:#1E1040;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .brand{color:#E8DEFF;font-size:16px;font-weight:600;letter-spacing:1px}
  .brand span{color:#C8A84B;font-size:11px;display:block;font-weight:400;margin-top:1px}
  .top-right{display:flex;align-items:center;gap:12px}
  .lang-toggle{display:flex;gap:4px}
  .lang-btn{padding:4px 10px;border-radius:5px;font-size:12px;cursor:pointer;border:none;background:#3D2580;color:#B89FFF;transition:all 0.2s}
  .lang-btn.active{background:#C8A84B;color:#1A0E3D;font-weight:600}
  .stats-bar{background:#2D1B6E;padding:8px 20px;display:flex;gap:24px;flex-shrink:0}
  .stat{text-align:center}
  .stat-n{font-size:20px;font-weight:600;color:#E8DEFF}
  .stat-l{font-size:10px;color:#9F7FEA;margin-top:1px}
  .main{display:flex;flex:1;overflow:hidden}
  .sidebar{width:280px;background:#1A0D3B;display:flex;flex-direction:column;flex-shrink:0}
  .filter-row{padding:8px 12px;display:flex;gap:5px;flex-wrap:wrap;border-bottom:1px solid #2D1B6E}
  .f-btn{padding:4px 10px;border-radius:10px;font-size:11px;border:none;cursor:pointer;background:#2D1B6E;color:#9F7FEA;transition:all 0.2s}
  .f-btn.active{background:#7F77DD;color:#EEEDFE}
  .search-box{padding:8px 12px;border-bottom:1px solid #2D1B6E}
  .search-box input{width:100%;padding:6px 10px;border-radius:6px;border:none;background:#2D1B6E;color:#E8DEFF;font-size:12px;outline:none}
  .search-box input::placeholder{color:#534AB7}
  .conv-list{flex:1;overflow-y:auto}
  .conv-item{padding:10px 14px;border-bottom:1px solid #2D1B6E;cursor:pointer;transition:background 0.15s}
  .conv-item:hover,.conv-item.active{background:#2D1B6E}
  .conv-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
  .conv-num{font-size:12px;font-weight:600;color:#E8DEFF}
  .conv-time{font-size:10px;color:#534AB7}
  .conv-prev{font-size:11px;color:#7C5FD4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .badge{display:inline-block;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:500;margin-top:4px}
  .badge.pending{background:#C8A84B22;color:#C8A84B;border:0.5px solid #C8A84B}
  .badge.bot{background:#1D9E7522;color:#1D9E75;border:0.5px solid #1D9E75}
  .badge.resolved{background:#534AB722;color:#9F7FEA;border:0.5px solid #534AB7}
  .chat-area{flex:1;display:flex;flex-direction:column;background:#f0eef8}
  .chat-head{padding:12px 18px;background:white;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .ch-left{display:flex;align-items:center;gap:10px}
  .avatar{width:38px;height:38px;border-radius:50%;background:#EEEDFE;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#534AB7;flex-shrink:0}
  .ch-name{font-size:14px;font-weight:600;color:#1E1040}
  .ch-sub{font-size:11px;color:#888;margin-top:1px}
  .ch-actions{display:flex;gap:6px}
  .act-btn{padding:5px 12px;border-radius:6px;font-size:12px;border:1px solid #ddd;background:white;color:#555;cursor:pointer;transition:all 0.2s}
  .act-btn:hover{background:#f5f5f5}
  .act-btn.primary{background:#2D1B6E;color:#E8DEFF;border-color:#2D1B6E}
  .act-btn.success{background:#1D9E75;color:white;border-color:#1D9E75}
  .messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}
  .msg-wrap{display:flex;flex-direction:column;max-width:65%}
  .msg-wrap.right{align-self:flex-end;align-items:flex-end}
  .msg-wrap.left{align-self:flex-start}
  .msg{padding:9px 13px;border-radius:10px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
  .msg.customer{background:white;border:1px solid #eee;border-radius:10px 10px 10px 2px;color:#333}
  .msg.bot{background:#EEEDFE;border-radius:10px 10px 2px 10px;color:#26215C}
  .msg.agent{background:#2D1B6E;border-radius:10px 10px 2px 10px;color:#E8DEFF}
  .msg-meta{font-size:10px;color:#aaa;margin-top:3px;padding:0 3px}
  .quick-replies{padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;background:white;border-top:1px solid #eee;flex-shrink:0}
  .qr-label{font-size:10px;color:#aaa;width:100%;margin-bottom:2px}
  .qr{padding:5px 12px;border-radius:14px;font-size:11px;border:1px solid #ddd;background:white;color:#555;cursor:pointer;transition:all 0.2s;white-space:nowrap}
  .qr:hover{background:#EEEDFE;border-color:#9F7FEA;color:#534AB7}
  .reply-box{padding:10px 14px;border-top:1px solid #eee;display:flex;gap:8px;align-items:center;background:white;flex-shrink:0}
  .reply-box textarea{flex:1;padding:8px 14px;border:1px solid #ddd;border-radius:10px;font-size:13px;background:#fafafa;color:#333;outline:none;resize:none;height:40px;font-family:sans-serif;transition:border 0.2s}
  .reply-box textarea:focus{border-color:#7C5FD4;height:72px}
  .send-btn{padding:8px 18px;background:#2D1B6E;color:#E8DEFF;border:none;border-radius:10px;font-size:13px;cursor:pointer;white-space:nowrap;transition:background 0.2s}
  .send-btn:hover{background:#3D2580}
  .empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#aaa;gap:8px}
  .empty-state .big{font-size:40px}
  .empty-state p{font-size:14px}
  .ar{font-family:'Noto Naskh Arabic',sans-serif;direction:rtl}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#3D2580;border-radius:4px}
</style>
</head>
<body>

<div class="topbar">
  <div class="brand">GLAMLY Support <span>where beauty made ease · حيث يصبح الجمال أمراً سهلاً</span></div>
  <div class="top-right">
    <div class="lang-toggle">
      <button class="lang-btn active" onclick="setLang('en')">EN</button>
      <button class="lang-btn" onclick="setLang('ar')">ع</button>
    </div>
  </div>
</div>

<div class="stats-bar" id="statsBar">
  <div class="stat"><div class="stat-n" id="s-total">0</div><div class="stat-l" id="l-total">Total</div></div>
  <div class="stat"><div class="stat-n" style="color:#C8A84B" id="s-pending">0</div><div class="stat-l" id="l-pending">Pending</div></div>
  <div class="stat"><div class="stat-n" style="color:#1D9E75" id="s-bot">0</div><div class="stat-l" id="l-bot">Bot handled</div></div>
  <div class="stat"><div class="stat-n" style="color:#9F7FEA" id="s-resolved">0</div><div class="stat-l" id="l-resolved">Resolved</div></div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="filter-row">
      <button class="f-btn active" onclick="setFilter('all',this)" id="f-all">All</button>
      <button class="f-btn" onclick="setFilter('pending',this)" id="f-pending">Pending</button>
      <button class="f-btn" onclick="setFilter('bot',this)" id="f-bot">Bot</button>
      <button class="f-btn" onclick="setFilter('resolved',this)" id="f-resolved">Resolved</button>
    </div>
    <div class="search-box">
      <input id="searchInput" placeholder="Search conversations..." oninput="renderList()">
    </div>
    <div class="conv-list" id="convList"></div>
  </div>

  <div class="chat-area" id="chatArea">
    <div class="empty-state">
      <div class="big">💬</div>
      <p id="empty-msg">Select a conversation to start</p>
    </div>
  </div>
</div>

<script>
let conversations = {};
let activeNumber = null;
let currentFilter = 'all';
let currentLang = 'en';

const labels = {
  en: {
    total:'Total', pending:'Pending', bot:'Bot handled', resolved:'Resolved',
    all:'All', search:'Search conversations...',
    select:'Select a conversation to start',
    lastSeen:'Last seen', ago:'ago',
    bookingLookup:'Booking lookup', markResolved:'Mark resolved', assignMe:'Assign to me',
    quickReplies:'Quick replies:',
    qr1:'Share your booking ID', qr2:'Cancellation policy', qr3:'Refund info', qr4:'Thank you message',
    placeholder:'Type your reply in English or Arabic...',
    send:'Send',
    customer:'Customer', bot2:'Bot', agent:'Agent',
    statusLabel:'Status'
  },
  ar: {
    total:'الكل', pending:'انتظار', bot:'بوت', resolved:'محلول',
    all:'الكل', search:'ابحث في المحادثات...',
    select:'اختر محادثة للبدء',
    lastSeen:'آخر ظهور', ago:'مضت',
    bookingLookup:'بحث عن حجز', markResolved:'تم الحل', assignMe:'تعيين لي',
    quickReplies:'ردود سريعة:',
    qr1:'أرسل رقم الحجز', qr2:'سياسة الإلغاء', qr3:'معلومات الاسترداد', qr4:'رسالة شكر',
    placeholder:'اكتب ردك بالعربي أو الإنجليزي...',
    send:'إرسال',
    customer:'العميل', bot2:'بوت', agent:'موظف',
    statusLabel:'الحالة'
  }
};

const quickReplies = {
  en: [
    'Please share your booking ID so I can help you.',
    'Cancellations made 24hrs before appointment are fully refunded.',
    'Your refund will be processed within 3-5 business days.',
    'Thank you for choosing Glamly! Have a beautiful day 💜'
  ],
  ar: [
    'من فضلك أرسل رقم حجزك حتى أتمكن من مساعدتك.',
    'الإلغاء قبل 24 ساعة من الموعد يحصل على استرداد كامل.',
    'سيتم معالجة استرداد المبلغ خلال 3-5 أيام عمل.',
    'شكراً لاختيارك Glamly! يوم جميل 💜'
  ]
};

function setLang(lang) {
  currentLang = lang;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(\`.lang-btn:nth-child(\${lang==='en'?1:2})\`).classList.add('active');
  const L = labels[lang];
  document.getElementById('l-total').textContent    = L.total;
  document.getElementById('l-pending').textContent  = L.pending;
  document.getElementById('l-bot').textContent      = L.bot;
  document.getElementById('l-resolved').textContent = L.resolved;
  document.getElementById('f-all').textContent      = L.all;
  document.getElementById('f-pending').textContent  = L.pending;
  document.getElementById('f-bot').textContent      = L.bot;
  document.getElementById('f-resolved').textContent = L.resolved;
  document.getElementById('searchInput').placeholder = L.search;
  document.getElementById('empty-msg').textContent  = L.select;
  renderList();
  if (activeNumber) openConversation(activeNumber);
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff/60) + 'm';
  if (diff < 86400) return Math.floor(diff/3600) + 'h';
  return Math.floor(diff/86400) + 'd';
}

function getInitials(number) {
  const n = number.replace('whatsapp:+','');
  return n.slice(-2);
}

function renderList() {
  const list = document.getElementById('convList');
  const search = document.getElementById('searchInput').value.toLowerCase();
  list.innerHTML = '';
  let total=0, pending=0, bot=0, resolved=0;

  for (const [number, data] of Object.entries(conversations)) {
    total++;
    if (data.status === 'pending') pending++;
    else if (data.status === 'bot') bot++;
    else if (data.status === 'resolved') resolved++;

    if (currentFilter !== 'all' && data.status !== currentFilter) continue;
    const last = data.messages[data.messages.length-1];
    const preview = last ? last.message.substring(0,40) : '';
    if (search && !number.includes(search) && !preview.toLowerCase().includes(search)) continue;

    const div = document.createElement('div');
    div.className = 'conv-item' + (number === activeNumber ? ' active' : '');
    div.innerHTML = \`
      <div class="conv-top">
        <span class="conv-num">\${number.replace('whatsapp:+','')}</span>
        <span class="conv-time">\${timeAgo(data.lastSeen)}</span>
      </div>
      <div class="conv-prev">\${preview}</div>
      <span class="badge \${data.status}">\${data.status === 'pending' ? (currentLang==='ar'?'انتظار':'Pending') : data.status === 'bot' ? (currentLang==='ar'?'بوت':'Bot') : (currentLang==='ar'?'محلول':'Resolved')}</span>
    \`;
    div.onclick = () => openConversation(number);
    list.appendChild(div);
  }

  document.getElementById('s-total').textContent   = total;
  document.getElementById('s-pending').textContent = pending;
  document.getElementById('s-bot').textContent     = bot;
  document.getElementById('s-resolved').textContent= resolved;
}

function openConversation(number) {
  activeNumber = number;
  const data = conversations[number];
  const L = labels[currentLang];
  const isAr = currentLang === 'ar';
  const num = number.replace('whatsapp:+','');

  document.getElementById('chatArea').innerHTML = \`
    <div class="chat-head">
      <div class="ch-left">
        <div class="avatar">\${getInitials(number)}</div>
        <div>
          <div class="ch-name">+\${num}</div>
          <div class="ch-sub">\${L.statusLabel}: \${data.status} · \${L.lastSeen} \${timeAgo(data.lastSeen)} \${L.ago}</div>
        </div>
      </div>
      <div class="ch-actions">
        <button class="act-btn" onclick="lookupBooking('\${num}')">\${L.bookingLookup}</button>
        <button class="act-btn success" onclick="markResolved('\${number}')">\${L.markResolved}</button>
        <button class="act-btn primary">\${L.assignMe}</button>
      </div>
    </div>
    <div class="messages" id="messages">
      \${data.messages.map(m => \`
        <div class="msg-wrap \${m.from === 'customer' ? 'left' : 'right'}">
          <div class="msg \${m.from} \${isAr && m.from !== 'bot' ? 'ar' : ''}">\${m.message}</div>
          <div class="msg-meta">\${m.from === 'customer' ? L.customer : m.from === 'bot' ? L.bot2 : L.agent} · \${new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
      \`).join('')}
    </div>
    <div class="quick-replies">
      <div class="qr-label">\${L.quickReplies}</div>
      \${quickReplies[currentLang].map(q => \`<button class="qr \${isAr?'ar':''}" onclick="setReply(this.textContent)">\${q}</button>\`).join('')}
    </div>
    <div class="reply-box">
      <textarea id="replyInput" placeholder="\${L.placeholder}" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendReply()}"></textarea>
      <button class="send-btn" onclick="sendReply()">\${L.send}</button>
    </div>
  \`;

  document.getElementById('messages').scrollTop = 99999;
  renderList();
}

function setReply(text) {
  const inp = document.getElementById('replyInput');
  if (inp) inp.value = text;
}

async function sendReply() {
  const input = document.getElementById('replyInput');
  const message = input.value.trim();
  if (!message || !activeNumber) return;
  const number = activeNumber.replace('whatsapp:+','');
  input.value = '';
  await fetch('/reply', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ to: number, message })
  });
  await loadConversations();
  openConversation(activeNumber);
}

async function markResolved(number) {
  await fetch('/status', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ number, status: 'resolved' })
  });
  await loadConversations();
  if (activeNumber === number) openConversation(number);
}

function lookupBooking(number) {
  alert('Booking lookup for: +' + number + '\\nConnect this to your Glamly database to show booking details.');
}

async function loadConversations() {
  const res = await fetch('/conversations');
  conversations = await res.json();
  renderList();
}

loadConversations();
setInterval(loadConversations, 8000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, () => console.log("Glamly webhook running on port 3000"));
