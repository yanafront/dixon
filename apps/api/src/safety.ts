import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { reportInput } from "../../../packages/types/src";
import {
  Db,
  AuthGuard,
  AuthRequest,
  adult,
  parse,
  fail,
  adminRole,
  rate,
  excluded,
} from "./core";
import { analytics } from "./notifications";
import { EventsService } from "./events";
import { MediaService } from "./media";
@Controller()
@UseGuards(AuthGuard)
export class SafetyController {
  constructor(
    private db: Db,
    private events: EventsService,
    private media: MediaService,
  ) {}
  @Post("blocks") async block(@Req() r: AuthRequest, @Body() body: unknown) {
    await adult(this.db, r.user.id);
    const { userId } = parse(
      z
        .object({
          userId: z
            .string()
            .uuid()
            .transform((v) => v.toLowerCase()),
        })
        .strict(),
      body,
    );
    if (userId === r.user.id)
      fail(422, "INVALID_TARGET", "Cannot block yourself");
    await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const [a, b] = [r.user.id, userId].sort();
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${a + ":" + b},0))`;
      await tx.block.upsert({
        where: {
          blockerId_blockedId: { blockerId: r.user.id, blockedId: userId },
        },
        create: { blockerId: r.user.id, blockedId: userId },
        update: {},
      });
      await tx.match.updateMany({
        where: { userAId: a, userBId: b },
        data: { isActive: false },
      });
      await analytics(tx, r.user.id, "block_created");
    });
    return { blocked: true };
  }
  @Delete("blocks/:id") async unblock(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    parse(z.string().uuid(), id);
    await this.db.block.deleteMany({
      where: { blockerId: r.user.id, blockedId: id },
    });
    return { blocked: false };
  }
  @Post("reports") async report(@Req() r: AuthRequest, @Body() body: unknown) {
    await adult(this.db, r.user.id);
    await rate(this.db, `report:${r.user.id}`, 10, 86400);
    const d = parse(reportInput, body);
    if (d.targetUserId)
      await this.db.user.findUniqueOrThrow({ where: { id: d.targetUserId } });
    if (d.targetEventId)
      await this.events.accessible(d.targetEventId, r.user.id);
    if (d.targetPhotoId)
      await this.db.userPhoto.findUniqueOrThrow({
        where: { id: d.targetPhotoId },
      });
    const row = await this.db.report.create({
      data: { reporterId: r.user.id, ...d },
    });
    await analytics(this.db, r.user.id, "report_created");
    return { id: row.id, status: row.status };
  }
  @Get("admin/reports") async reports(@Req() r: AuthRequest) {
    adminRole(r.user);
    return {
      items: await this.db.report.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      nextCursor: null,
    };
  }
  @Patch("admin/reports/:id") async review(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    adminRole(r.user);
    parse(z.string().uuid(), id);
    const d = parse(
      z
        .object({
          status: z.enum(["IN_REVIEW", "RESOLVED", "REJECTED"]),
          reason: z.string().min(3).max(1000),
        })
        .strict(),
      body,
    );
    return this.db.$transaction(async (tx) => {
      const row = await tx.report.update({
        where: { id },
        data: { status: d.status },
      });
      await tx.moderationAction.create({
        data: {
          actorId: r.user.id,
          targetId: id,
          action: `REPORT_${d.status}`,
          reason: d.reason,
        },
      });
      return row;
    });
  }
  @Get("admin/users") async users(@Req() r: AuthRequest) {
    adminRole(r.user);
    return {
      items: await this.db.user.findMany({
        select: {
          id: true,
          firstName: true,
          role: true,
          isBlocked: true,
          isVerified: true,
        },
        take: 100,
      }),
      nextCursor: null,
    };
  }
  @Patch("admin/users/:id/block") async suspend(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    adminRole(r.user, true);
    parse(z.string().uuid(), id);
    const d = parse(
      z
        .object({ blocked: z.boolean(), reason: z.string().min(3).max(1000) })
        .strict(),
      body,
    );
    const target = await this.db.user.findUniqueOrThrow({ where: { id } });
    if (target.role !== "USER" || id === r.user.id)
      fail(403, "PROTECTED_ACCOUNT", "Cannot moderate a staff account");
    return this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isBlocked: d.blocked } });
      if (d.blocked) {
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.locationStatus.deleteMany({ where: { userId: id } });
      }
      await tx.moderationAction.create({
        data: {
          actorId: r.user.id,
          targetId: id,
          action: d.blocked ? "SUSPEND" : "RESTORE",
          reason: d.reason,
        },
      });
      return { blocked: d.blocked };
    });
  }
  @Patch("admin/users/:id/verify") async verify(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    adminRole(r.user, true);
    parse(z.string().uuid(), id);
    const d = parse(
      z
        .object({ verified: z.boolean(), reason: z.string().min(3).max(1000) })
        .strict(),
      body,
    );
    return this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isVerified: d.verified } });
      await tx.moderationAction.create({
        data: {
          actorId: r.user.id,
          targetId: id,
          action: "VERIFY",
          reason: d.reason,
        },
      });
      return { verified: d.verified };
    });
  }
  @Get("admin/events") async adminEvents(@Req() r: AuthRequest) {
    adminRole(r.user);
    return {
      items: await this.db.event.findMany({
        select: { id: true, title: true, isCancelled: true, creatorId: true },
        take: 100,
      }),
      nextCursor: null,
    };
  }
  @Delete("admin/events/:id") async deleteEvent(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    adminRole(r.user, true);
    return this.events.cancel(r.user.id, id, true);
  }
  @Delete("admin/photos/:id") async deletePhoto(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    adminRole(r.user, true);
    await this.db.moderationAction.create({
      data: {
        actorId: r.user.id,
        targetId: id,
        action: "DELETE_PHOTO",
        reason: "Admin photo moderation",
      },
    });
    return this.media.remove(r.user.id, id, true);
  }
  @Get("admin/analytics") async metrics(@Req() r: AuthRequest) {
    adminRole(r.user);
    const now = Date.now();
    const active = async (days: number) => {
      const rows = await this.db.analyticsEvent.findMany({
        where: { createdAt: { gte: new Date(now - days * 86400000) } },
        distinct: ["userId"],
        select: { userId: true },
      });
      return rows.filter((x) => x.userId).length;
    };
    const count = (name: string) =>
      this.db.analyticsEvent.count({ where: { name } });
    const [
      dau,
      wau,
      mau,
      registrations,
      onboarding,
      events,
      joins,
      likes,
      matches,
    ] = await Promise.all([
      active(1),
      active(7),
      active(30),
      this.db.user.count(),
      this.db.profile.count(),
      count("event_created"),
      count("event_joined"),
      count("swipe_like"),
      count("match_created"),
    ]);
    return {
      dau,
      wau,
      mau,
      registrations,
      onboarding,
      events,
      joins,
      likes,
      matches,
      matchConversion: likes ? (matches * 2) / likes : 0,
      retention: await Promise.all(
        [1, 7, 30].map(async (day) => {
          const rows = await this.db.$queryRaw<
            { eligible: bigint; retained: bigint }[]
          >`
          SELECT COUNT(*) AS eligible, COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM "AnalyticsEvent" a WHERE a."userId"=u.id
            AND (a."createdAt" AT TIME ZONE 'UTC')::date = (u."createdAt" AT TIME ZONE 'UTC')::date + ${day}::int
          )) AS retained FROM "User" u WHERE (u."createdAt" AT TIME ZONE 'UTC')::date <= (NOW() AT TIME ZONE 'UTC')::date - ${day}::int`;
          const eligible = Number(rows[0].eligible),
            retained = Number(rows[0].retained);
          return {
            day,
            eligible,
            retained,
            rate: eligible ? retained / eligible : null,
          };
        }),
      ),
      confirmedMeetings: await this.db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM (
          SELECT p."eventId" FROM "EventParticipant" p JOIN "Event" e ON e.id=p."eventId"
          WHERE p."confirmedAt" IS NOT NULL AND e."isCancelled"=false AND e."dateEnd" <= NOW()
          GROUP BY p."eventId" HAVING COUNT(*) >= 2
        ) confirmed`.then((rows) => Number(rows[0].count)),
    };
  }
}
