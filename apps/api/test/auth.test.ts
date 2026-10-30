import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
// Import compiled Nest code so decorator metadata uses the same pipeline as production.
const { validateInitData, age } = require("../dist/apps/api/src/core.js");
const token = "unit-test-token";
const now = 1800000000;
function signed(date = now) {
  const p = new URLSearchParams({
    auth_date: String(date),
    user: JSON.stringify({ id: 123456, first_name: "Test" }),
  });
  const data = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  return p.toString();
}
test("valid Telegram initData", () =>
  assert.equal(validateInitData(signed(), token, now).id, 123456));
test("forged signature rejected", () =>
  assert.throws(
    () => validateInitData(signed().replace("Test", "Fake"), token, now),
    { status: 401 },
  ));
test("expired auth_date rejected", () =>
  assert.throws(() => validateInitData(signed(now - 301), token, now), {
    status: 401,
  }));
test("future auth_date rejected", () =>
  assert.throws(() => validateInitData(signed(now + 60), token, now), {
    status: 401,
  }));
test("duplicate query keys rejected", () =>
  assert.throws(() => validateInitData(signed() + "&auth_date=1", token, now), {
    status: 401,
  }));
test("age on exact birthday, before birthday and leap birthday", () => {
  assert.equal(age(new Date("2008-10-30"), new Date("2026-10-30")), 18);
  assert.equal(age(new Date("2008-10-31"), new Date("2026-10-30")), 17);
  assert.equal(age(new Date("2008-02-29"), new Date("2026-02-28")), 17);
});

test("public profile never exposes DOB, Telegram contact, session or private location", () => {
  const { publicUser } = require("../dist/apps/api/src/core.js");
  const u = {
    id: "user",
    firstName: "User",
    telegramId: "123",
    telegramUsername: "private_contact",
    role: "ADMIN",
    profile: {
      birthDate: new Date("1996-01-01"),
      city: "Минск",
      bio: "",
      gender: "UNDISCLOSED",
      sportLevel: "BEGINNER",
    },
    location: {
      latitude: 53.912345,
      longitude: 27.54321,
      publicLatitude: 53.92,
      publicLongitude: 27.54,
      showDistance: true,
      audience: "MATCHES",
      expiresAt: new Date(Date.now() + 3600000),
    },
    photos: [],
    sports: [],
    goals: [],
    sessions: [{ tokenHash: "secret" }],
  };
  const dto = publicUser(u, { publicLatitude: 53.9, publicLongitude: 27.5 });
  assert.equal(dto.distanceKm, null);
  for (const key of [
    "telegramId",
    "telegramUsername",
    "role",
    "sessions",
    "birthDate",
    "location",
    "latitude",
    "longitude",
  ])
    assert(!(key in dto));
});
