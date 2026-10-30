import test from "node:test";
import assert from "node:assert/strict";
const { setupTelegram } = require("../dist/apps/api/src/telegram-setup.js");
const options = {
  token: "test-token",
  backendUrl: "https://api.example.com",
  frontendUrl: "https://app.example.com",
  secret: "test-secret-".repeat(5),
};
test("Telegram setup verifies bot and registers secret webhook and Mini App menu", async () => {
  const calls: { url: string; body: any }[] = [];
  const send = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(
      JSON.stringify({
        ok: true,
        result: url.endsWith("/getMe") ? { username: "dixon_test_bot" } : true,
      }),
      { status: 200 },
    );
  };
  const result = await setupTelegram(options, send);
  assert.equal(result.username, "dixon_test_bot");
  assert.equal(calls.length, 3);
  assert.equal(
    calls[1].body.url,
    "https://api.example.com/api/v1/telegram/webhook",
  );
  assert.equal(calls[1].body.secret_token, options.secret);
  assert.equal(calls[1].body.drop_pending_updates, false);
  assert.equal(
    calls[2].body.menu_button.web_app.url,
    "https://app.example.com",
  );
});
test("invalid Telegram token aborts webhook and menu registration", async () => {
  let calls = 0;
  const send = async () => {
    calls++;
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  };
  await assert.rejects(() => setupTelegram(options, send));
  assert.equal(calls, 1);
});
test("Telegram setup rejects insecure origins before network access", async () => {
  let calls = 0;
  await assert.rejects(() =>
    setupTelegram(
      { ...options, backendUrl: "http://api.example.com" },
      async () => {
        calls++;
        throw new Error("Should not send");
      },
    ),
  );
  assert.equal(calls, 0);
});
