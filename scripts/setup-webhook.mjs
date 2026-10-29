const { BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, BACKEND_URL } = process.env;
if (
  !BOT_TOKEN ||
  !TELEGRAM_WEBHOOK_SECRET ||
  !BACKEND_URL?.startsWith("https://")
)
  throw new Error(
    "Set BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and HTTPS BACKEND_URL in environment",
  );
const result = await fetch(
  `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: BACKEND_URL.replace(/\/$/, "") + "/api/v1/telegram/webhook",
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
  },
);
const data = await result.json();
if (!data.ok) throw new Error("Webhook registration failed");
console.log("Webhook registered.");
