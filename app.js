const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const twilio = require("twilio");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

const accountSid = "YOUR_ACCOUNT_SID";
const authToken  = "YOUR_AUTH_TOKEN";
const client     = twilio(accountSid, authToken);
const fromNumber = "whatsapp:+966534864736";

// Store conversations in memory (we'll upgrade to a database later)
const conversations = {};

// ─── Auto-reply bot logic ───────────────────────────────────────
function getBotReply(message) {
  const msg = message.toLowerCase();

  if (msg.includes("booking") || msg.includes("حجز")) {
    return "To check your booking status, please share your booking ID and we'll look it up for you!";
  }
  if (msg.includes("cancel") || msg.includes("إلغاء")) {
    return "To cancel a booking, please share your booking ID. Cancellations made 24hrs before are fully refunded.";
  }
  if (msg.includes("price") || msg.includes("سعر") || msg.includes("كم")) {
    return "You can browse all service prices in the Glamly app. Download it at glamly.app";
  }
  if (msg.includes("hello") || msg.includes("hi") || msg.includes("مرحبا") || msg.includes("هلا")) {
    return "👋 Welcome to Glamly! Where beauty made ease.\n\nHow can we help you today?\n1. Booking status\n2. Cancel a booking\n3. Prices\n4. Talk to an agent";
  }
  if (msg.includes("agent") || msg.includes("human") || msg.includes("موظف") || msg.includes("4")) {
    return "Connecting you to one of our agents. Please wait a moment! 🙏";
  }

  // Default — escalate to human
  return null;
}

// ─── Webhook — receives messages from Twilio ────────────────────
app.post("/webhook", (req, res) => {
  const from    = req.body.From;
  const message = req.body.Body;
  const time    = new Date().toISOString();

  console.log(`Message from ${from}: ${message}`);

  // Store message
  if (!conversations[from]) conversations[from] = [];
  conversations[from].push({ from: "customer", message, time });

  // Get bot reply
  const botReply = getBotReply(message);

  if (botReply) {
    // Bot handles it
    conversations[from].push({ from: "bot", message: botReply, time });
    client.messages.create({
      from: fromNumber,
      to: from,
      body: botReply
    });
  } else {
    // Escalate to human — notify your team
    const agentAlert = `⚠️ New message needs attention:\nFrom: ${from}\nMessage: ${message}`;
    conversations[from].push({ from: "pending", message, time });
    console.log("ESCALATED:", agentAlert);
  }

  res.status(200).send("OK");
});

// ─── Dashboard — get all conversations ─────────────────────────
app.get("/conversations", (req, res) => {
  res.json(conversations);
});

// ─── Send reply from agent dashboard ───────────────────────────
app.post("/reply", async (req, res) => {
  const { to, message } = req.body;
  try {
    await client.messages.create({
      from: fromNumber,
      to: `whatsapp:${to}`,
      body: message
    });
    if (conversations[`whatsapp:${to}`]) {
      conversations[`whatsapp:${to}`].push({
        from: "agent",
        message,
        time: new Date().toISOString()
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Glamly webhook running on port 3000"));
