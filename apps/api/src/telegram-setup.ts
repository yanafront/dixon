import { Injectable, OnModuleInit } from "@nestjs/common";
import * as Sentry from "@sentry/node";
export const telegramState: { username: string | null; configured: boolean } = {
  username: null,
  configured: false,
};
export async function setupTelegram(
  options: {
    token: string;
    backendUrl: string;
    frontendUrl: string;
    secret: string;
  },
  send: typeof fetch = fetch,
) {
  const { token, secret } = options;
  const backend = new URL(options.backendUrl),
    frontend = new URL(options.frontendUrl);
  if (
    backend.protocol !== "https:" ||
    frontend.protocol !== "https:" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
  )
    throw new Error("Invalid Telegram setup configuration");
  const call = async (method: string, body: Record<string, unknown>) => {
    const response = await send(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
    const data: any = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(`Telegram setup ${method} failed`);
    return data.result;
  };
  const bot = await call("getMe", {});
  if (
    typeof bot?.username !== "string" ||
    !/^[A-Za-z0-9_]{5,32}$/.test(bot.username)
  )
    throw new Error("Invalid bot username");
  await call("setWebhook", {
    url: backend.origin + "/api/v1/telegram/webhook",
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  await call("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Открыть DIXON",
      web_app: { url: frontend.origin },
    },
  });
  return { username: bot.username };
}
@Injectable()
export class TelegramSetup implements OnModuleInit {
  async onModuleInit() {
    if (process.env.NODE_ENV !== "production" || !process.env.BACKEND_URL)
      return;
    try {
      const result = await setupTelegram({
        token: process.env.BOT_TOKEN!,
        backendUrl: process.env.BACKEND_URL,
        frontendUrl: process.env.FRONTEND_URL!.split(",")[0],
        secret: process.env.TELEGRAM_WEBHOOK_SECRET!,
      });
      telegramState.username = result.username;
      telegramState.configured = true;
      console.log(
        JSON.stringify({ level: "info", event: "telegram_setup_complete" }),
      );
    } catch {
      Sentry.captureException(new Error("Telegram setup failed"));
      console.error(
        JSON.stringify({ level: "error", event: "telegram_setup_failed" }),
      );
    }
  }
}
