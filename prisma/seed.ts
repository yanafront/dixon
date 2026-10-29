import { PrismaClient } from "@prisma/client";
import { sports } from "../packages/types/src";
const db = new PrismaClient();
async function main() {
  for (const code of sports)
    await db.sportInterest.upsert({
      where: { code },
      create: { code, name: code },
      update: {},
    });
  const admins = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .filter(Boolean);
  await db.user.updateMany({
    where: { telegramId: { in: admins } },
    data: { role: "ADMIN" },
  });
  if (process.env.SEED_DEMO === "true") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Demo seed is forbidden in production");
    const u = await db.user.upsert({
      where: { telegramId: "900001" },
      create: { telegramId: "900001", firstName: "Local organizer" },
      update: {},
    });
    await db.club.upsert({
      where: { id: "00000000-0000-4000-8000-000000000001" },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Dixon Running Club [LOCAL TEST]",
        description: "Local test club, not a real community",
        creatorId: u.id,
        members: { create: { userId: u.id, role: "OWNER" } },
      },
      update: {},
    });
    for (let i = 1; i <= 2; i++)
      await db.event.upsert({
        where: { id: `00000000-0000-4000-8000-00000000001${i}` },
        create: {
          id: `00000000-0000-4000-8000-00000000001${i}`,
          creatorId: u.id,
          title: `Local test run ${i}`,
          description: "Test event only",
          category: "running",
          city: "Минск",
          dateStart: new Date(Date.now() + i * 86400000),
          dateEnd: new Date(Date.now() + i * 86400000 + 3600000),
          latitude: 53.92,
          longitude: 27.55,
          locationName: "Local test point",
          capacity: 10,
          difficulty: "ANY",
          participants: { create: { userId: u.id } },
        },
        update: {},
      });
  }
}
main().finally(() => db.$disconnect());
