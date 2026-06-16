const express      = require("express");
const bodyParser   = require("body-parser");
const cors         = require("cors");
const twilio       = require("twilio");
const mysql        = require("mysql2/promise");
const jwt          = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(cookieParser());

const accountSid  = process.env.ACCOUNT_SID;
const authToken   = process.env.AUTH_TOKEN;
const client      = twilio(accountSid, authToken);
const fromNumber  = "whatsapp:+966534864736";
const JWT_SECRET  = process.env.JWT_SECRET  || "glamly_secret_2026";
const DASH_PASS   = process.env.DASHBOARD_PASSWORD || "glamly123";

// ── Database connection ──────────────────────────────────────────
let db;
async function connectDB() {
  db = await mysql.createPool({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
  });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(50) UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'bot',
      assigned_to VARCHAR(100),
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(50) NOT NULL,
      sender VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database connected!");
}
connectDB();

// ── Auth middleware ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ── Bot logic ────────────────────────────────────────────────────
function getBotReply(message) {
  const msg = message.toLowerCase().trim();

  if (msg === "1" || msg.includes("booking") || msg.includes("status") || msg.includes("حجز") || msg.includes("حالة"))
    return "📋 Please share your booking ID and we will check it for you!\n\nأرسل رقم حجزك وسنتحقق منه فوراً!";

  if (msg === "2" || msg.includes("cancel") || msg.includes("إلغاء") || msg.includes("الغ"))
    return "❌ To cancel your booking please share your booking ID.\n\nCancellations made 24hrs before are fully refunded.\n\nلإلغاء حجزك أرسل رقم الحجز.\nالإلغاء قبل 24 ساعة يحصل على استرداد كامل.";

  if (msg === "3" || msg.includes("price") || msg.includes("سعر") || msg.includes("كم") || msg.includes("تكلفة"))
    return "💰 Browse all prices in the Glamly app!\n\nglamlysa.com\n\nتصفح جميع الأسعار في تطبيق Glamly!\nglamlysa.com";

  if (msg === "4" || msg.includes("agent") || msg.includes("human") || msg.includes("موظف") || msg.includes("مساعدة"))
    return "👩‍💼 Connecting you to an agent now. Please wait!\n\nجاري تحويلك لموظف. لحظة من فضلك!";

  if (msg.includes("hello") || msg.includes("hi") || msg.includes("مرحبا") || msg.includes("هلا") || msg.includes("اهلا") || msg.includes("السلام"))
    return "👋 Welcome to Glamly — where beauty made ease!\nأهلاً بك في Glamly!\n\n1️⃣ Booking status · حالة الحجز\n2️⃣ Cancel booking · إلغاء الحجز\n3️⃣ Prices · الأسعار\n4️⃣ Talk to agent · التحدث مع موظف";

  if (msg.includes("thank") || msg.includes("شكر") || msg.includes("شكراً"))
    return "🌸 You're most welcome!\nعلى الرحب والسعة!\n\nGlamly — where beauty made ease 💜";

  return null;
}

// ── Webhook ──────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const from    = req.body.From;
  const message = req.body.Body;

  try {
    await db.execute(
      `INSERT INTO conversations (phone, status, last_seen)
       VALUES (?, 'bot', NOW())
       ON DUPLICATE KEY UPDATE last_seen = NOW()`,
      [from]
    );

    await db.execute(
      `INSERT INTO messages (phone, sender, message) VALUES (?, 'customer', ?)`,
      [from, message]
    );

    const botReply = getBotReply(message);

    if (botReply) {
      await db.execute(
        `INSERT INTO messages (phone, sender, message) VALUES (?, 'bot', ?)`,
        [from, botReply]
      );
      await db.execute(
        `UPDATE conversations SET status = 'bot' WHERE phone = ?`,
        [from]
      );
      client.messages.create({ from: fromNumber, to: from, body: botReply });
    } else {
      await db.execute(
        `UPDATE conversations SET status = 'pending' WHERE phone = ?`,
        [from]
      );
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  res.status(200).send("OK");
});

// ── API: conversations ───────────────────────────────────────────
app.get("/conversations", requireAuth, async (req, res) => {
  try {
    const [convs] = await db.execute(
      `SELECT * FROM conversations ORDER BY last_seen DESC`
    );
    const result = {};
    for (const conv of convs) {
      const [msgs] = await db.execute(
        `SELECT * FROM messages WHERE phone = ? ORDER BY created_at ASC`,
        [conv.phone]
      );
      result[conv.phone] = {
        status:     conv.status,
        assignedTo: conv.assigned_to,
        lastSeen:   conv.last_seen,
        messages:   msgs.map(m => ({
          from:    m.sender,
          message: m.message,
          time:    m.created_at
        }))
      };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: agent reply ─────────────────────────────────────────────
app.post("/reply", requireAuth, async (req, res) => {
  const { to, message } = req.body;
  const fullNumber = `whatsapp:+${to}`;
  try {
    await client.messages.create({ from: fromNumber, to: fullNumber, body: message });
    await db.execute(
      `INSERT INTO messages (phone, sender, message) VALUES (?, 'agent', ?)`,
      [fullNumber, message]
    );
    await db.execute(
      `UPDATE conversations SET status = 'resolved', last_seen = NOW() WHERE phone = ?`,
      [fullNumber]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: update status ───────────────────────────────────────────
app.post("/status", requireAuth, async (req, res) => {
  const { number, status } = req.body;
  try {
    await db.execute(
      `UPDATE conversations SET status = ? WHERE phone = ?`,
      [status, number]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: booking lookup ──────────────────────────────────────────
app.get("/booking/:id", requireAuth, async (req, res) => {
  const bookingId = req.params.id;
  res.json({
    id:       bookingId,
    customer: "Connect to your Glamly database",
    service:  "to show real booking data",
    date:     "here",
    status:   "pending"
  });
});

// ── Login ────────────────────────────────────────────────────────
app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password !== DASH_PASS) return res.status(401).json({ error: "Wrong password" });
  const token = jwt.sign({ role: "agent" }, JWT_SECRET, { expiresIn: "12h" });
  res.cookie("token", token, { httpOnly: true, maxAge: 43200000 });
  res.json({ success: true, token });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ── Gift notification ────────────────────────────────────────────
app.post("/send-gift", async (req, res) => {
  const { recipientPhone, senderName, serviceName, salonName, bookingLink, language } = req.body;
  const templateSid = language === "ar"
    ? process.env.TEMPLATE_SID_AR
    : process.env.TEMPLATE_SID_EN;

  try {
    await client.messages.create({
      from:        fromNumber,
      to:          `whatsapp:+${recipientPhone}`,
      contentSid:  templateSid,
      contentVariables: JSON.stringify({
        "1": senderName,
        "2": serviceName,
        "3": salonName,
        "4": bookingLink
      })
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard ────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glamly Support</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#f0eef8;height:100vh;overflow:hidden;display:flex;flex-direction:column}
.login-screen{display:flex;align-items:center;justify-content:center;height:100vh;background:#1E1040}
.login-box{background:#2D1B6E;padding:40px;border-radius:16px;width:320px;text-align:center}
.login-box h2{color:#E8DEFF;font-size:22px;margin-bottom:6px}
.login-box p{color:#9F7FEA;font-size:13px;margin-bottom:24px}
.login-box input{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #534AB7;background:#1E1040;color:#E8DEFF;font-size:14px;outline:none;margin-bottom:12px}
.login-box button{width:100%;padding:11px;background:#C8A84B;color:#1A0E3D;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
.login-box .err{color:#F09595;font-size:12px;margin-top:8px}
.app{display:none;flex-direction:column;height:100vh}
.topbar{background:#1E1040;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.brand{color:#E8DEFF;font-size:16px;font-weight:600;letter-spacing:1px}
.brand span{color:#C8A84B;font-size:11px;display:block;font-weight:400}
.top-right{display:flex;align-items:center;gap:12px}
.lang-toggle{display:flex;gap:4px}
.lang-btn{padding:4px 10px;border-radius:5px;font-size:12px;cursor:pointer;border:none;background:#3D2580;color:#B89FFF}
.lang-btn.active{background:#C8A84B;color:#1A0E3D;font-weight:600}
.logout-btn{padding:4px 12px;border-radius:5px;font-size:12px;cursor:pointer;border:none;background:#3D2580;color:#F09595}
.stats-bar{background:#2D1B6E;padding:8px 20px;display:flex;gap:24px;flex-shrink:0}
.stat{text-align:center}
.stat-n{font-size:20px;font-weight:600;color:#E8DEFF}
.stat-l{font-size:10px;color:#9F7FEA;margin-top:1px}
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:280px;background:#1A0D3B;display:flex;flex-direction:column;flex-shrink:0}
.filter-row{padding:8px 12px;display:flex;gap:5px;flex-wrap:wrap;border-bottom:1px solid #2D1B6E}
.f-btn{padding:4px 10px;border-radius:10px;font-size:11px;border:none;cursor:pointer;background:#2D1B6E;color:#9F7FEA}
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
.act-btn{padding:5px 12px;border-radius:6px;font-size:12px;border:1px solid #ddd;background:white;color:#555;cursor:pointer}
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
.booking-card{background:#EEEDFE;border:1px solid #AFA9EC;border-radius:10px;padding:12px 16px;margin:8px 0;font-size:13px;color:#26215C}
.booking-card h4{font-size:13px;font-weight:600;margin-bottom:8px;color:#3C3489}
.booking-card table{width:100%}
.booking-card td{padding:3px 0;font-size:12px}
.booking-card td:first-child{color:#534AB7;width:100px}
.quick-replies{padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;background:white;border-top:1px solid #eee;flex-shrink:0}
.qr-label{font-size:10px;color:#aaa;width:100%;margin-bottom:2px}
.qr{padding:5px 12px;border-radius:14px;font-size:11px;border:1px solid #ddd;background:white;color:#555;cursor:pointer;white-space:nowrap}
.qr:hover{background:#EEEDFE;border-color:#9F7FEA;color:#534AB7}
.reply-box{padding:10px 14px;border-top:1px solid #eee;display:flex;gap:8px;align-items:center;background:white;flex-shrink:0}
.reply-box textarea{flex:1;padding:8px 14px;border:1px solid #ddd;border-radius:10px;font-size:13px;background:#fafafa;color:#333;outline:none;resize:none;height:40px;font-family:sans-serif}
.reply-box textarea:focus{border-color:#7C5FD4;height:72px}
.send-btn{padding:8px 18px;background:#2D1B6E;color:#E8DEFF;border:none;border-radius:10px;font-size:13px;cursor:pointer}
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#aaa;gap:8px}
.empty-state .big{font-size:40px}
.ar{font-family:'Noto Naskh Arabic',sans-serif;direction:rtl}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-thumb{background:#3D2580;border-radius:4px}
</style>
</head>
<body>

<div class="login-screen" id="loginScreen">
  <div class="login-box">
    <h2>GLAMLY</h2>
    <p>Support Dashboard · لوحة دعم العملاء</p>
    <input type="password" id="passInput" placeholder="Enter password · كلمة المرور" onkeydown="if(event.key==='Enter')doLogin()">
    <button onclick="doLogin()">Login · دخول</button>
    <div class="err" id="loginErr"></div>
  </div>
</div>

<div class="app" id="app">
  <div class="topbar">
    <div class="brand">GLAMLY Support<span>where beauty made ease</span></div>
    <div class="top-right">
      <div class="lang-toggle">
        <button class="lang-btn active" onclick="setLang('en')">EN</button>
        <button class="lang-btn" onclick="setLang('ar')">ع</button>
      </div>
      <button class="logout-btn" onclick="doLogout()">Logout</button>
    </div>
  </div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-n" id="s-total">0</div><div class="stat-l" id="l-total">Total</div></div>
    <div class="stat"><div class="stat-n" style="color:#C8A84B" id="s-pending">0</div><div class="stat-l" id="l-pending">Pending</div></div>
    <div class="stat"><div class="stat-n" style="color:#1D9E75" id="s-bot">0</div><div class="stat-l" id="l-bot">Bot handled</div></div>
    <div class="stat"><div class="stat-n" style="color:#9F7FEA" id="s-resolved">0</div><div class="stat-l" id="l-resolved">Resolved</div></div>
  </div>
  <div class="main">
    <div class="sidebar">
      <div class="filter-row">
        <button class="f-btn active" onclick="setFilter('all',this)">All</button>
        <button class="f-btn" onclick="setFilter('pending',this)" id="f-pending">Pending</button>
        <button class="f-btn" onclick="setFilter('bot',this)">Bot</button>
        <button class="f-btn" onclick="setFilter('resolved',this)">Resolved</button>
      </div>
      <div class="search-box"><input id="searchInput" placeholder="Search..." oninput="renderList()"></div>
      <div class="conv-list" id="convList"></div>
    </div>
    <div class="chat-area" id="chatArea">
      <div class="empty-state"><div class="big">💬</div><p id="empty-msg">Select a conversation</p></div>
    </div>
  </div>
</div>

<script>
let conversations={}, activeNumber=null, currentFilter='all', currentLang='en', authToken='';

const quickReplies={
  en:['Please share your booking ID so I can help you.','Cancellations made 24hrs before appointment are fully refunded.','Your refund will be processed within 3-5 business days.','Thank you for choosing Glamly! Have a beautiful day 💜'],
  ar:['من فضلك أرسل رقم حجزك حتى أتمكن من مساعدتك.','الإلغاء قبل 24 ساعة من الموعد يحصل على استرداد كامل.','سيتم معالجة استرداد المبلغ خلال 3-5 أيام عمل.','شكراً لاختيارك Glamly! يوم جميل 💜']
};

async function doLogin(){
  const pass=document.getElementById('passInput').value;
  const res=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})});
  const data=await res.json();
  if(data.success){
    authToken=data.token;
    document.getElementById('loginScreen').style.display='none';
    document.getElementById('app').style.display='flex';
    loadConversations();
  } else {
    document.getElementById('loginErr').textContent='Wrong password · كلمة مرور خاطئة';
  }
}

async function doLogout(){
  await fetch('/logout',{method:'POST'});
  authToken='';
  document.getElementById('app').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}

function authHeaders(){return{Authorization:'Bearer '+authToken,'Content-Type':'application/json'}}

function setLang(lang){
  currentLang=lang;
  document.querySelectorAll('.lang-btn').forEach((b,i)=>b.classList.toggle('active',i===(lang==='en'?0:1)));
  renderList();
  if(activeNumber) openConversation(activeNumber);
}

function setFilter(f,btn){
  currentFilter=f;
  document.querySelectorAll('.f-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

function timeAgo(iso){
  const d=Math.floor((Date.now()-new Date(iso))/1000);
  if(d<60) return d+'s'; if(d<3600) return Math.floor(d/60)+'m';
  if(d<86400) return Math.floor(d/3600)+'h'; return Math.floor(d/86400)+'d';
}

function renderList(){
  const list=document.getElementById('convList');
  const search=document.getElementById('searchInput').value.toLowerCase();
  list.innerHTML='';
  let total=0,pending=0,bot=0,resolved=0;
  for(const [number,data] of Object.entries(conversations)){
    total++;
    if(data.status==='pending') pending++;
    else if(data.status==='bot') bot++;
    else if(data.status==='resolved') resolved++;
    if(currentFilter!=='all'&&data.status!==currentFilter) continue;
    const last=data.messages[data.messages.length-1];
    const preview=last?last.message.substring(0,40):'';
    if(search&&!number.includes(search)&&!preview.toLowerCase().includes(search)) continue;
    const div=document.createElement('div');
    div.className='conv-item'+(number===activeNumber?' active':'');
    const badgeText=data.status==='pending'?(currentLang==='ar'?'انتظار':'Pending'):data.status==='bot'?(currentLang==='ar'?'بوت':'Bot'):(currentLang==='ar'?'محلول':'Resolved');
    div.innerHTML=\`<div class="conv-top"><span class="conv-num">\${number.replace('whatsapp:+','')}</span><span class="conv-time">\${timeAgo(data.lastSeen)}</span></div><div class="conv-prev">\${preview}</div><span class="badge \${data.status}">\${badgeText}</span>\`;
    div.onclick=()=>openConversation(number);
    list.appendChild(div);
  }
  document.getElementById('s-total').textContent=total;
  document.getElementById('s-pending').textContent=pending;
  document.getElementById('s-bot').textContent=bot;
  document.getElementById('s-resolved').textContent=resolved;
}

function openConversation(number){
  activeNumber=number;
  const data=conversations[number];
  const isAr=currentLang==='ar';
  const num=number.replace('whatsapp:+','');
  document.getElementById('chatArea').innerHTML=\`
    <div class="chat-head">
      <div class="ch-left">
        <div class="avatar">\${num.slice(-2)}</div>
        <div><div class="ch-name">+\${num}</div><div class="ch-sub">Status: \${data.status} · \${timeAgo(data.lastSeen)} ago</div></div>
      </div>
      <div class="ch-actions">
        <button class="act-btn" onclick="lookupBooking()">\${isAr?'بحث عن حجز':'Booking lookup'}</button>
        <button class="act-btn success" onclick="markResolved('\${number}')">\${isAr?'تم الحل':'Mark resolved'}</button>
        <button class="act-btn primary">\${isAr?'تعيين لي':'Assign to me'}</button>
      </div>
    </div>
    <div class="messages" id="messages">
      \${data.messages.map(m=>\`
        <div class="msg-wrap \${m.from==='customer'?'left':'right'}">
          <div class="msg \${m.from} \${isAr?'ar':''}">\${m.message}</div>
          <div class="msg-meta">\${m.from==='customer'?(isAr?'العميل':'Customer'):m.from==='bot'?'Bot':(isAr?'موظف':'Agent')} · \${new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
      \`).join('')}
    </div>
    <div class="quick-replies">
      <div class="qr-label">\${isAr?'ردود سريعة:':'Quick replies:'}</div>
      \${quickReplies[currentLang].map(q=>\`<button class="qr \${isAr?'ar':''}" onclick="setReply(this.textContent)">\${q}</button>\`).join('')}
    </div>
    <div class="reply-box">
      <textarea id="replyInput" placeholder="\${isAr?'اكتب ردك...':'Type your reply...'}" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendReply()}"></textarea>
      <button class="send-btn" onclick="sendReply()">\${isAr?'إرسال':'Send'}</button>
    </div>
  \`;
  document.getElementById('messages').scrollTop=99999;
  renderList();
}

function setReply(text){const i=document.getElementById('replyInput');if(i)i.value=text}

async function sendReply(){
  const input=document.getElementById('replyInput');
  const message=input.value.trim();
  if(!message||!activeNumber) return;
  input.value='';
  await fetch('/reply',{method:'POST',headers:authHeaders(),body:JSON.stringify({to:activeNumber.replace('whatsapp:+',''),message})});
  await loadConversations();
  openConversation(activeNumber);
}

async function markResolved(number){
  await fetch('/status',{method:'POST',headers:authHeaders(),body:JSON.stringify({number,status:'resolved'})});
  await loadConversations();
  if(activeNumber===number) openConversation(number);
}

async function lookupBooking(){
  const bookingId=prompt('Enter booking ID:');
  if(!bookingId) return;
  const res=await fetch('/booking/'+bookingId,{headers:authHeaders()});
  const data=await res.json();
  const msgs=document.getElementById('messages');
  const card=document.createElement('div');
  card.className='msg-wrap left';
  card.innerHTML=\`<div class="booking-card"><h4>Booking #\${data.id}</h4><table><tr><td>Customer</td><td>\${data.customer}</td></tr><tr><td>Service</td><td>\${data.service}</td></tr><tr><td>Date</td><td>\${data.date}</td></tr><tr><td>Status</td><td>\${data.status}</td></tr></table></div>\`;
  msgs.appendChild(card);
  msgs.scrollTop=99999;
}

async function loadConversations(){
  if(!authToken) return;
  const res=await fetch('/conversations',{headers:authHeaders()});
  if(res.status===401){doLogout();return}
  conversations=await res.json();
  renderList();
}

setInterval(()=>{if(authToken)loadConversations()},8000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, () => console.log("Glamly webhook running on port 3000"));
