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

let db;
async function connectDB() {
  try {
    db = await mysql.createPool({
      uri: process.env.DATABASE_URL,
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
    await db.execute(`
      CREATE TABLE IF NOT EXISTS gifts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gift_code VARCHAR(20) UNIQUE NOT NULL,
        sender_name VARCHAR(100) NOT NULL,
        recipient_phone VARCHAR(20) NOT NULL,
        service_name VARCHAR(200) NOT NULL,
        salon_name VARCHAR(200) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Database connected!");
  } catch (err) {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  }
}
connectDB();

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
    console.error("Webhook error:", err.message);
  }
  res.status(200).send("OK");
});

app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password !== DASH_PASS) return res.status(401).json({ error: "Wrong password" });
  const token = jwt.sign({ role: "agent" }, JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, { httpOnly: true, maxAge: 86400000 });
  res.json({ success: true, token });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.get("/conversations", requireAuth, async (req, res) => {
  try {
    const [convs] = await db.execute(`SELECT * FROM conversations ORDER BY last_seen DESC`);
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
        messages:   msgs.map(m => ({ from: m.sender, message: m.message, time: m.created_at }))
      };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.post("/status", requireAuth, async (req, res) => {
  const { number, status } = req.body;
  try {
    await db.execute(`UPDATE conversations SET status = ? WHERE phone = ?`, [status, number]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/booking/:id", requireAuth, async (req, res) => {
  res.json({
    id:       req.params.id,
    customer: "Connect to your Glamly database",
    service:  "to show real booking data",
    date:     "here",
    status:   "pending"
  });
});

app.post("/send-gift", async (req, res) => {
  const { recipientPhone, senderName, serviceName, salonName, language } = req.body;
  const templateSid = language === "ar" ? process.env.TEMPLATE_SID_AR : process.env.TEMPLATE_SID_EN;
  try {
    await client.messages.create({
      from:             fromNumber,
      to:               `whatsapp:+${recipientPhone}`,
      contentSid:       templateSid,
      contentVariables: JSON.stringify({ "1": senderName, "2": serviceName, "3": salonName, "4": "gift" })
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/create-gift", async (req, res) => {
  const { senderName, recipientPhone, serviceName, salonName, language } = req.body;
  const giftCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  const giftLink = `https://glamly-webhook-production.up.railway.app/gift`;
  const templateSid = language === "ar" ? process.env.TEMPLATE_SID_AR : process.env.TEMPLATE_SID_EN;
  try {
    await db.execute(
      `INSERT INTO gifts (gift_code, sender_name, recipient_phone, service_name, salon_name)
       VALUES (?, ?, ?, ?, ?)`,
      [giftCode, senderName, recipientPhone, serviceName, salonName]
    );
    await client.messages.create({
      from:             fromNumber,
      to:               `whatsapp:+${recipientPhone}`,
      contentSid:       templateSid,
      contentVariables: JSON.stringify({
        "1": senderName,
        "2": serviceName,
        "3": salonName,
        "4": giftCode
      })
    });
    res.json({ success: true, giftCode, giftLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/gift", (req, res) => {
  const code = req.query.code || '';
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Glamly – هديتكِ بانتظارك</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Naskh Arabic',sans-serif;background:#0F0A28;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#1E1040;border-radius:24px;padding:36px 28px;max-width:380px;width:100%;text-align:center}
.brand{color:#E8DEFF;font-size:24px;font-weight:700;letter-spacing:4px;font-family:sans-serif}
.tagline{color:#C8A84B;font-size:11px;font-family:sans-serif;margin-bottom:24px}
.gift-emoji{font-size:64px;margin:16px 0}
h1{color:#FFFFFF;font-size:20px;margin-bottom:10px;line-height:1.5}
p{color:#9F7FEA;font-size:14px;margin-bottom:24px;line-height:1.7}
input{width:100%;padding:14px;border-radius:12px;border:1px solid #3D2580;background:#2D1B6E;color:#E8DEFF;font-size:18px;text-align:center;font-family:'Noto Naskh Arabic',sans-serif;outline:none;letter-spacing:4px;margin-bottom:12px}
input::placeholder{color:#534AB7;letter-spacing:0}
.btn{display:block;width:100%;padding:16px;border-radius:14px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:12px;cursor:pointer;border:none;font-family:'Noto Naskh Arabic',sans-serif}
.btn-main{background:#C8A84B;color:#0F0A28}
.footer{color:#3D2870;font-size:11px;margin-top:20px;font-family:sans-serif}
</style>
</head>
<body>
<div class="card">
  <div class="brand">GLAMLY</div>
  <div class="tagline">where beauty made ease</div>
  <div class="gift-emoji">🎁</div>
  <h1>أدخلي رمز هديتكِ</h1>
  <p>ستجدين الرمز في رسالة WhatsApp التي وصلتكِ</p>
  <input type="text" id="codeInput" placeholder="مثال: ABC12345" maxlength="8" oninput="this.value=this.value.toUpperCase()">
  <button class="btn btn-main" onclick="openGift()">🎀 عرض هديتكِ</button>
  <div class="footer">Glamly – حيث يصبح الجمال أمراً سهلاً</div>
</div>
<script>
  const preCode = "${code}";
  if(preCode){
    document.getElementById('codeInput').value = preCode;
    window.location.href = '/gift/' + preCode;
  }
  function openGift(){
    const code = document.getElementById('codeInput').value.trim();
    if(!code){ alert('من فضلكِ أدخلي الرمز'); return; }
    window.location.href = '/gift/' + code;
  }
  document.getElementById('codeInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter') openGift();
  });
</script>
</body>
</html>`);
});

app.get("/gift/:code", async (req, res) => {
  const { code } = req.params;
  try {
    const [rows] = await db.execute(
      `SELECT * FROM gifts WHERE gift_code = ?`,
      [code]
    );
    if (rows.length === 0) {
      return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>body{background:#0F0A28;color:#E8DEFF;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;flex-direction:column;gap:16px}</style>
</head><body><div style="font-size:48px">😔</div><h2>هذه الهدية غير موجودة</h2><p style="color:#9F7FEA">Gift not found</p></body></html>`);
    }
    const gift = rows[0];
    const appleUrl  = process.env.APPLE_STORE_URL  || 'https://apps.apple.com';
    const googleUrl = process.env.GOOGLE_PLAY_URL || 'https://play.google.com';
    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Glamly – هديتكِ بانتظارك</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Naskh Arabic',sans-serif;background:#0F0A28;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#1E1040;border-radius:24px;padding:36px 28px;max-width:380px;width:100%;text-align:center}
.brand{color:#E8DEFF;font-size:24px;font-weight:700;letter-spacing:4px;font-family:sans-serif}
.tagline{color:#C8A84B;font-size:11px;font-family:sans-serif;margin-bottom:24px}
.gift-emoji{font-size:64px;margin:16px 0}
.from{color:#9F7FEA;font-size:14px;margin-bottom:6px}
.from span{color:#C8A84B;font-weight:700}
h1{color:#FFFFFF;font-size:22px;margin-bottom:20px;line-height:1.5}
.divider{width:80%;height:1px;background:#2D1B6E;margin:20px auto}
.detail-box{background:#2D1B6E;border-radius:14px;padding:16px;margin-bottom:20px;text-align:right}
.detail-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #3D2580}
.detail-row:last-child{border-bottom:none}
.detail-label{color:#9F7FEA;font-size:13px}
.detail-value{color:#E8DEFF;font-size:14px;font-weight:600}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:16px;border-radius:14px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:12px;transition:opacity 0.2s;font-family:'Noto Naskh Arabic',sans-serif;cursor:pointer;border:none}
.btn:hover{opacity:0.9}
.btn-main{background:#C8A84B;color:#0F0A28}
.btn-apple{background:#FFFFFF;color:#000000;font-size:14px}
.btn-android{background:#1D9E75;color:#FFFFFF;font-size:14px}
.status{display:inline-block;padding:4px 14px;border-radius:20px;font-size:12px;margin-bottom:16px}
.status.pending{background:#C8A84B22;color:#C8A84B;border:1px solid #C8A84B}
.status.used{background:#1D9E7522;color:#1D9E75;border:1px solid #1D9E75}
.footer{color:#3D2870;font-size:11px;margin-top:20px;font-family:sans-serif}
.divider-text{color:#534AB7;font-size:12px;margin-bottom:12px}
</style>
</head>
<body>
<div class="card">
  <div class="brand">GLAMLY</div>
  <div class="tagline">where beauty made ease</div>
  <div class="gift-emoji">🎁</div>
  <div class="from">أهدتكِ <span>${gift.sender_name}</span> هدية مميزة!</div>
  <h1>تجربة تجميل فاخرة بانتظاركِ ✨</h1>
  <span class="status ${gift.status === 'used' ? 'used' : 'pending'}">
    ${gift.status === 'used' ? '✅ تم الاستخدام' : '🎀 لم تُستخدم بعد'}
  </span>
  <div class="divider"></div>
  <div class="detail-box">
    <div class="detail-row">
      <span class="detail-value">${gift.service_name}</span>
      <span class="detail-label">✨ الخدمة</span>
    </div>
    <div class="detail-row">
      <span class="detail-value">${gift.salon_name}</span>
      <span class="detail-label">📍 المكان</span>
    </div>
    <div class="detail-row">
      <span class="detail-value">${new Date(gift.created_at).toLocaleDateString('ar-SA')}</span>
      <span class="detail-label">📅 تاريخ الهدية</span>
    </div>
  </div>
  <a href="glamly://gift/${gift.gift_code}" class="btn btn-main">
    🗓️ احجزي موعدكِ الآن
  </a>
  <div class="divider-text">إذا لم يكن التطبيق مثبتاً لديكِ، حمّليه من هنا:</div>
  <a href="${appleUrl}" class="btn btn-apple">🍎 App Store</a>
  <a href="${googleUrl}" class="btn btn-android">🤖 Google Play</a>
  <div class="footer">Glamly – حيث يصبح الجمال أمراً سهلاً</div>
</div>
<script>
  setTimeout(function(){
    window.location.href = "glamly://gift/${gift.gift_code}";
  }, 500);
</script>
</body>
</html>`);
  } catch (err) {
    console.error("Gift page error:", err.message);
    res.status(500).send("Error loading gift");
  }
});

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
.login-err{color:#F09595;font-size:12px;margin-top:8px}
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
.reply-box textarea{flex:1;padding:8px 14px;border:1px solid #ddd;border-radius:10px;font-size:13px;background:#fafafa;color:#333;outline:none;resize:none;height:40px;font-family:sans-serif;transition:border 0.2s}
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
    <input type="password" id="passInput" placeholder="Password · كلمة المرور" onkeydown="if(event.key==='Enter')doLogin()">
    <button onclick="doLogin()">Login · دخول</button>
    <div class="login-err" id="loginErr"></div>
  </div>
</div>
<div class="app" id="app">
  <div class="topbar">
    <div class="brand">GLAMLY Support<span>where beauty made ease · حيث يصبح الجمال أمراً سهلاً</span></div>
    <div class="top-right">
      <div class="lang-toggle">
        <button class="lang-btn active" onclick="setLang('en')">EN</button>
        <button class="lang-btn" onclick="setLang('ar')">ع</button>
      </div>
      <button class="logout-btn" onclick="doLogout()">Logout · خروج</button>
    </div>
  </div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-n" id="s-total">0</div><div class="stat-l">Total</div></div>
    <div class="stat"><div class="stat-n" style="color:#C8A84B" id="s-pending">0</div><div class="stat-l">Pending</div></div>
    <div class="stat"><div class="stat-n" style="color:#1D9E75" id="s-bot">0</div><div class="stat-l">Bot handled</div></div>
    <div class="stat"><div class="stat-n" style="color:#9F7FEA" id="s-resolved">0</div><div class="stat-l">Resolved</div></div>
  </div>
  <div class="main">
    <div class="sidebar">
      <div class="filter-row">
        <button class="f-btn active" onclick="setFilter('all',this)">All</button>
        <button class="f-btn" onclick="setFilter('pending',this)">Pending</button>
        <button class="f-btn" onclick="setFilter('bot',this)">Bot</button>
        <button class="f-btn" onclick="setFilter('resolved',this)">Resolved</button>
      </div>
      <div class="search-box"><input id="searchInput" placeholder="Search..." oninput="renderList()"></div>
      <div class="conv-list" id="convList"></div>
    </div>
    <div class="chat-area" id="chatArea">
      <div class="empty-state"><div class="big">💬</div><p>Select a conversation</p></div>
    </div>
  </div>
</div>
<script>
let conversations={},activeNumber=null,currentFilter='all',currentLang='en';
let authToken=localStorage.getItem('glamly_token')||'';
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
    localStorage.setItem('glamly_token',authToken);
    showApp();
  } else {
    document.getElementById('loginErr').textContent='Wrong password · كلمة مرور خاطئة';
  }
}
async function doLogout(){
  await fetch('/logout',{method:'POST'});
  authToken='';
  localStorage.removeItem('glamly_token');
  document.getElementById('app').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
}
function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='flex';
  loadConversations();
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
  if(d<60) return d+'s';
  if(d<3600) return Math.floor(d/60)+'m';
  if(d<86400) return Math.floor(d/3600)+'h';
  return Math.floor(d/86400)+'d';
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
  if(!msgs) return;
  const card=document.createElement('div');
  card.className='msg-wrap left';
  card.innerHTML=\`<div class="booking-card"><h4>Booking #\${data.id}</h4><table><tr><td>Customer</td><td>\${data.customer}</td></tr><tr><td>Service</td><td>\${data.service}</td></tr><tr><td>Date</td><td>\${data.date}</td></tr><tr><td>Status</td><td>\${data.status}</td></tr></table></div>\`;
  msgs.appendChild(card);
  msgs.scrollTop=99999;
}
async function loadConversations(){
  if(!authToken) return;
  try{
    const res=await fetch('/conversations',{headers:authHeaders()});
    if(res.status===401){doLogout();return}
    conversations=await res.json();
    renderList();
    if(activeNumber&&conversations[activeNumber]) openConversation(activeNumber);
  } catch(err){
    console.error('Failed to load:',err);
  }
}
if(authToken) showApp();
setInterval(()=>{if(authToken)loadConversations()},8000);
</script>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, () => console.log("Glamly webhook running on port 3000"));
