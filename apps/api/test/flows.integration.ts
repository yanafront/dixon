import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import supertest from "supertest";
const { createApp } = require("../dist/apps/api/src/bootstrap.js");
function initData(id: number) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id,
      first_name: `Tester ${id}`,
      username: `tester_${id}`,
    }),
  });
  const d = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN!)
    .digest();
  p.set("hash", createHmac("sha256", key).update(d).digest("hex"));
  return p.toString();
}
const profile = {
  firstName: "Tester",
  birthDate: "1996-01-01",
  gender: "FEMALE",
  city: "Минск",
  bio: "Integration test",
  sportLevel: "BEGINNER",
  datingEnabled: false,
  isHidden: false,
  contactConsent: false,
  goals: ["SPORT", "FRIENDS"],
  sports: ["running"],
};
test("HTTP + real PostgreSQL critical paths, concurrency, safety, RBAC and deletion", async () => {
  if (
    process.env.NODE_ENV !== "test" ||
    !process.env.DATABASE_URL?.includes("dixon_test")
  )
    throw new Error("Use a dedicated dixon_test database and NODE_ENV=test");
  const db = new PrismaClient();
  const app = await createApp();
  await app.init();
  const http = supertest(app.getHttpServer());
  const tokens: string[] = [],
    ids: string[] = [];
  try {
    await db.sportInterest.upsert({
      where: { code: "running" },
      create: { code: "running", name: "Running" },
      update: {},
    });
    for (const id of [910001, 910002, 910003, 910004]) {
      const login = await http
        .post("/api/v1/auth/telegram")
        .send({ initData: initData(id) })
        .expect(201);
      tokens.push(login.body.token);
      ids.push(login.body.user.id);
    }
    const call = (
      i: number,
      method: "get" | "post" | "patch" | "delete",
      path: string,
      body?: unknown,
    ) => {
      const r = http[method]("/api/v1" + path).set(
        "Authorization",
        `Bearer ${tokens[i]}`,
      );
      return body === undefined ? r : r.send(body as any);
    };
    for (let i = 0; i < 4; i++)
      await call(i, "patch", "/users/me", {
        ...profile,
        firstName: `Tester ${i}`,
      }).expect(200);
    await call(0, "patch", "/users/me", {
      ...profile,
      birthDate: "2015-01-01",
    }).expect(422);
    await call(0, "get", "/admin/reports").expect(403);
    const initial = await call(0, "get", "/discover?mode=SPORT").expect(200);
    assert(initial.body.items.some((u: any) => u.id === ids[1]));
    const first = await call(0, "post", `/users/${ids[1]}/like`, {
      mode: "SPORT",
    }).expect(201);
    assert.equal(first.body.match, null);
    const mutual = await call(1, "post", `/users/${ids[0]}/like`, {
      mode: "SPORT",
    }).expect(201);
    assert(mutual.body.match.id);
    const duplicates = await Promise.all([
      call(0, "post", `/users/${ids[1]}/like`, { mode: "SPORT" }),
      call(1, "post", `/users/${ids[0]}/like`, { mode: "SPORT" }),
    ]);
    assert(duplicates.every((x) => x.status === 201));
    assert.equal(
      await db.match.count({
        where: { userAId: { in: ids }, userBId: { in: ids } },
      }),
      1,
    );
    await call(0, "post", `/matches/${mutual.body.match.id}/contact`).expect(
      409,
    );
    const start = new Date(Date.now() + 86400000),
      end = new Date(+start + 3600000);
    const created = await call(0, "post", "/events", {
      title: "Integration run",
      description: "Real database event",
      category: "running",
      city: "Минск",
      dateStart: start.toISOString(),
      dateEnd: end.toISOString(),
      latitude: 53.9,
      longitude: 27.56,
      locationName: "Public park",
      capacity: 2,
      difficulty: "ANY",
      price: 0,
      parameters: {},
      isPrivate: false,
    }).expect(201);
    const eventId = created.body.id;
    assert.equal(created.body.participantCount, 1);
    const attempts = await Promise.all([
      call(1, "post", `/events/${eventId}/join`),
      call(2, "post", `/events/${eventId}/join`),
    ]);
    assert.deepEqual(attempts.map((x) => x.status).sort(), [201, 409]);
    const winner = attempts[0].status === 201 ? 1 : 2;
    const duplicate = await call(
      winner,
      "post",
      `/events/${eventId}/join`,
    ).expect(201);
    assert.equal(duplicate.body.participantCount, 2);
    await call(winner, "post", `/events/${eventId}/save`).expect(201);
    const saved = await call(winner, "get", "/events?saved=true").expect(200);
    assert(saved.body.items.some((e: any) => e.id === eventId));
    const left = await call(winner, "post", `/events/${eventId}/leave`).expect(
      201,
    );
    assert.equal(left.body.participantCount, 1);
    await call(2, "delete", `/events/${eventId}`).expect(403);
    await call(0, "post", "/blocks", { userId: ids[1] }).expect(201);
    const after = await call(1, "get", "/discover?mode=SPORT").expect(200);
    assert(!after.body.items.some((u: any) => u.id === ids[0]));
    await call(1, "get", `/users/${ids[0]}`).expect(404);
    await call(1, "post", `/events/${eventId}/join`).expect(404);
    const m = await call(0, "get", "/matches").expect(200);
    assert.equal(m.body.items.length, 0);
    const location = await http
      .put("/api/v1/users/me/location-status")
      .set("Authorization", `Bearer ${tokens[2]}`)
      .send({
        latitude: 53.912345,
        longitude: 27.54321,
        statusType: "SPORT",
        ttlHours: 1,
      })
      .expect(200);
    assert.notEqual(location.body.publicLatitude, 53.912345);
    await db.locationStatus.update({
      where: { userId: ids[2] },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const nearby = await call(3, "get", "/users/nearby").expect(200);
    assert(!nearby.body.items.some((u: any) => u.id === ids[2]));
    await call(3, "post", "/reports", {
      targetEventId: eventId,
      reason: "OTHER",
      description: "test",
    }).expect(201);
    await call(2, "delete", "/users/me").expect(200);
    await call(2, "get", "/users/me").expect(401);
    assert.equal(await db.user.findUnique({ where: { id: ids[2] } }), null);
    await http
      .post("/api/v1/telegram/webhook")
      .send({ update_id: 1 })
      .expect(401);
    await http.get("/api/v1/health").expect(200);
  } finally {
    await db.report.deleteMany({ where: { reporterId: { in: ids } } });
    await db.swipe.deleteMany({ where: { fromUserId: { in: ids } } });
    await db.match.deleteMany({ where: { userAId: { in: ids } } });
    await db.block.deleteMany({ where: { blockerId: { in: ids } } });
    await db.analyticsEvent.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await app.close();
  }
});
