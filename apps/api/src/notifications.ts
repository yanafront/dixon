import {
  Injectable,
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Param,
  Body,
  Headers,
  UseGuards,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import * as Sentry from "@sentry/node";
import { Db, AuthRequest, AuthGuard, fail, parse, hash } from "./core";
import { analyticsNames } from "../../../packages/types/src";
export async function analytics(
  tx: any,
  userId: string,
  name: string,
  properties: Record<string, unknown> = {},
) {
  const e = await tx.analyticsEvent.create({
    data: { userId, name, properties },
  });
  if (process.env.POSTHOG_API_KEY)
    await tx.outbox.create({
      data: {
        kind: "ANALYTICS",
        payload: { userId, name, properties },
        dedupeKey: `analytics:${e.id}`,
      },
    });
}
export async function notify(
  tx: any,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
  key: string,
) {
  const n = await tx.notification.upsert({
    where: { dedupeKey: key },
    create: { userId, type, payload, dedupeKey: key },
    update: {},
  });
  await tx.outbox.upsert({
    where: { dedupeKey: `telegram:${key}` },
    create: {
      kind: "TELEGRAM",
      payload: {
        userId,
        title: String(payload.title ?? type),
        notificationId: n.id,
      },
      dedupeKey: `telegram:${key}`,
    },
    update: {},
  });
}
export function s3() {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
}
@Injectable()
export class Worker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private db: Db) {}
  onModuleInit() {
    if (process.env.DISABLE_WORKER !== "true") {
      this.timer = setInterval(() => void this.tick(), 15000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.reminders();
      await this.db.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.db.rateBucket.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.db.webhookUpdate.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) } },
      });
      await this.db.locationStatus.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      const tasks = await this.db.$queryRaw<
        any[]
      >`UPDATE "Outbox" SET "availableAt"=NOW()+INTERVAL '2 minutes',attempts=attempts+1 WHERE id IN (SELECT id FROM "Outbox" WHERE "processedAt" IS NULL AND "availableAt" <= NOW() AND attempts < 8 ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`;
      for (const task of tasks) {
        try {
          const p = task.payload;
          if (task.kind === "DELETE_MEDIA") {
            await s3().send(
              new DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: p.key,
              }),
            );
          } else if (task.kind === "ANALYTICS") {
            if (process.env.POSTHOG_API_KEY) {
              const r = await fetch(
                `${process.env.POSTHOG_HOST || "https://eu.i.posthog.com"}/capture/`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    api_key: process.env.POSTHOG_API_KEY,
                    event: p.name,
                    properties: {
                      distinct_id: hash(p.userId),
                      ...p.properties,
                    },
                    uuid: task.id,
                  }),
                  signal: AbortSignal.timeout(10000),
                },
              );
              if (!r.ok) throw new Error("Analytics delivery failed");
            }
          } else if (task.kind === "TELEGRAM") {
            const u = await this.db.user.findUnique({
              where: { id: p.userId },
            });
            if (u?.botOptIn && u.isActive && !u.isBlocked) {
              const r = await fetch(
                `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: u.telegramId,
                    text: p.title,
                  }),
                  signal: AbortSignal.timeout(10000),
                },
              );
              const result: any = await r.json();
              if (!result.ok) {
                if (result.error_code === 403)
                  await this.db.user.update({
                    where: { id: u.id },
                    data: { botOptIn: false },
                  });
                else throw new Error("Telegram delivery failed");
              }
            }
          }
          await this.db.outbox.update({
            where: { id: task.id },
            data: { processedAt: new Date() },
          });
        } catch (error) {
          Sentry.captureException(new Error(`Outbox ${task.kind} failed`));
          console.error(
            JSON.stringify({
              level: "error",
              event: "outbox_failed",
              kind: task.kind,
              attempt: task.attempts,
            }),
          );
          await this.db.outbox.update({
            where: { id: task.id },
            data: {
              availableAt: new Date(
                Date.now() + Math.min(3600000, 2 ** task.attempts * 30000),
              ),
            },
          });
        }
      }
    } catch {
      console.error(JSON.stringify({ level: "error", event: "worker_failed" }));
    } finally {
      this.running = false;
    }
  }
  async reminders() {
    const rows = await this.db.event.findMany({
      where: {
        isCancelled: false,
        dateStart: { gt: new Date(), lte: new Date(Date.now() + 3600000) },
      },
      include: { participants: { where: { status: "JOINED" } } },
      take: 100,
    });
    for (const e of rows)
      for (const p of e.participants)
        await this.db.$transaction((tx) =>
          notify(
            tx,
            p.userId,
            "EVENT_REMINDER",
            { eventId: e.id, title: `Скоро начинается ${e.title}` },
            `reminder:${e.id}:${e.dateStart.toISOString()}:${p.userId}`,
          ),
        );
  }
}
@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private db: Db) {}
  @Get() async list(@Req() r: AuthRequest) {
    return {
      items: await this.db.notification.findMany({
        where: { userId: r.user.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      nextCursor: null,
    };
  }
  @Patch(":id/read") async read(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    parse(z.string().uuid(), id);
    await this.db.notification.updateMany({
      where: { id, userId: r.user.id },
      data: { readAt: new Date() },
    });
    return { read: true };
  }
}
@Controller("telegram")
export class TelegramController {
  constructor(private db: Db) {}
  @Post("webhook") async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string,
    @Body() body: unknown,
  ) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      !expected ||
      !secret ||
      !timingSafeEqual(Buffer.from(hash(expected)), Buffer.from(hash(secret)))
    )
      fail(401, "WEBHOOK_INVALID", "Unauthorized");
    const update = parse(
      z
        .object({
          update_id: z.number().int().safe(),
          message: z
            .object({
              text: z.string().optional(),
              chat: z.object({ id: z.number().int().safe(), type: z.string() }),
              from: z.object({ id: z.number().int().safe() }).optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
      body,
    );
    return this.db.$transaction(async (tx) => {
      const duplicate = await tx.webhookUpdate.createMany({
        data: [{ id: BigInt(update.update_id) }],
        skipDuplicates: true,
      });
      if (!duplicate.count) return { ok: true };
      const m = update.message;
      if (m?.from && m.chat.type === "private" && m.chat.id === m.from.id) {
        const text = m.text?.split(" ")[0];
        if (text === "/start" || text === "/stop")
          await tx.user.updateMany({
            where: { telegramId: String(m.from.id) },
            data: { botOptIn: text === "/start" },
          });
      }
      return { ok: true };
    });
  }
}
@Controller("analytics")
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private db: Db) {}
  @Post() async capture(@Req() r: AuthRequest, @Body() body: unknown) {
    const d = parse(z.object({ name: z.enum(analyticsNames) }).strict(), body);
    const clientNames = [
      "app_open",
      "onboarding_started",
      "onboarding_completed",
      "map_opened",
      "discover_opened",
      "event_viewed",
      "club_viewed",
      "profile_viewed",
    ];
    if (!clientNames.includes(d.name))
      fail(
        422,
        "SERVER_EVENT_ONLY",
        "Domain events are recorded by the server",
      );
    await analytics(this.db, r.user.id, d.name);
    return { accepted: true };
  }
}
