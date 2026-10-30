import {
  Injectable,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Req,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { eventInput } from "../../../packages/types/src";
import {
  Db,
  AuthGuard,
  AuthRequest,
  adult,
  parse,
  fail,
  excluded,
  ensureVisible,
  publicUser,
  userInclude,
  rate,
  distance,
} from "./core";
import { notify, analytics } from "./notifications";
const uuid = z.string().uuid();
const query = z
  .object({
    category: z.string().max(30).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    city: z.string().max(80).optional(),
    difficulty: z.string().max(30).optional(),
    joined: z.enum(["true", "false"]).optional(),
    saved: z.enum(["true", "false"]).optional(),
    distance: z.coerce.number().min(1).max(200).optional(),
    cursor: uuid.optional(),
  })
  .strict();
const include = {
  creator: {
    select: {
      id: true,
      firstName: true,
      isVerified: true,
      isActive: true,
      isBlocked: true,
    },
  },
  participants: {
    where: { status: "JOINED" as const },
    select: { userId: true },
  },
  saved: { select: { userId: true } },
};
export function eventDto(e: any, id: string) {
  const { participants, saved, ...rest } = e;
  return {
    ...rest,
    creator: {
      id: e.creator.id,
      firstName: e.creator.firstName,
      isVerified: e.creator.isVerified,
    },
    telegramChatUrl: participants.some((p: any) => p.userId === id)
      ? rest.telegramChatUrl
      : null,
    participantCount: participants.length,
    joined: participants.some((p: any) => p.userId === id),
    saved: saved.some((s: any) => s.userId === id),
  };
}
@Injectable()
export class EventsService {
  constructor(private db: Db) {}
  async accessible(id: string, userId: string, tx: any = this.db) {
    parse(uuid, id);
    const e = await tx.event.findUnique({ where: { id }, include });
    if (
      !e ||
      e.isCancelled ||
      !e.creator.isActive ||
      e.creator.isBlocked ||
      (await excluded(this.db, userId)).includes(e.creatorId) ||
      (e.isPrivate &&
        e.creatorId !== userId &&
        !e.participants.some((p: any) => p.userId === userId))
    )
      fail(404, "EVENT_UNAVAILABLE", "Event unavailable");
    return e;
  }
  async list(id: string, q: unknown) {
    const profile = await adult(this.db, id);
    const d = parse(query, q);
    const blocked = await excluded(this.db, id);
    const day = d.date ? new Date(d.date + "T00:00:00+03:00") : undefined;
    const rows = await this.db.event.findMany({
      where: {
        isCancelled: false,
        creator: { isActive: true, isBlocked: false },
        creatorId: { notIn: blocked },
        OR: [
          { isPrivate: false },
          { creatorId: id },
          { participants: { some: { userId: id, status: "JOINED" } } },
        ],
        ...(d.category ? { category: d.category } : {}),
        city: d.city ?? profile.city,
        ...(d.difficulty ? { difficulty: d.difficulty } : {}),
        dateStart: day
          ? { gte: day, lt: new Date(+day + 86400000) }
          : { gte: new Date() },
        ...(d.joined === "true"
          ? { participants: { some: { userId: id, status: "JOINED" } } }
          : {}),
        ...(d.saved === "true" ? { saved: { some: { userId: id } } } : {}),
      },
      include,
      orderBy: [{ dateStart: "asc" }, { id: "asc" }],
      take: 51,
      ...(d.cursor ? { cursor: { id: d.cursor }, skip: 1 } : {}),
    });
    let items = rows.slice(0, 50);
    if (d.distance) {
      const loc = await this.db.locationStatus.findUnique({
        where: { userId: id },
      });
      if (!loc || loc.expiresAt <= new Date())
        fail(
          422,
          "LOCATION_REQUIRED",
          "Enable approximate location for distance filtering",
        );
      items = items.filter(
        (e) =>
          distance(loc, {
            publicLatitude: e.latitude,
            publicLongitude: e.longitude,
          }) <= d.distance!,
      );
    }
    return {
      items: items.map((e) => eventDto(e, id)),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }
  async detail(userId: string, id: string) {
    await adult(this.db, userId);
    return eventDto(await this.accessible(id, userId), userId);
  }
  validateDates(d: z.infer<typeof eventInput>) {
    if (
      new Date(d.dateStart) <= new Date() ||
      new Date(d.dateEnd) <= new Date(d.dateStart)
    )
      fail(
        422,
        "INVALID_DATES",
        "Event must start in the future and end after start",
      );
    const rules: Record<string, z.ZodTypeAny> = {
      running: z
        .object({
          distance_km: z.number().positive().max(300).optional(),
          pace_min_km: z.number().min(2).max(20).optional(),
          surface: z.string().max(80).optional(),
        })
        .strict(),
      cycling: z
        .object({
          distance_km: z.number().positive().max(2000).optional(),
          speed_kmh: z.number().positive().max(100).optional(),
          bike_type: z.string().max(80).optional(),
        })
        .strict(),
      hiking: z
        .object({
          distance_km: z.number().positive().max(500).optional(),
          elevation_m: z.number().min(0).max(10000).optional(),
          duration_min: z.number().positive().max(50000).optional(),
          equipment: z.array(z.string().max(80)).max(20).optional(),
        })
        .strict(),
    };
    (
      rules[d.category] ??
      z.object({ notes: z.string().max(300).optional() }).strict()
    ).parse(d.parameters);
  }
  async create(userId: string, body: unknown) {
    await adult(this.db, userId);
    await rate(this.db, `create-event:${userId}`, 10, 86400);
    const d = parse(eventInput, body);
    this.validateDates(d);
    return this.db.$transaction(async (tx) => {
      const e = await tx.event.create({
        data: {
          ...d,
          dateStart: new Date(d.dateStart),
          dateEnd: new Date(d.dateEnd),
          creatorId: userId,
          participants: { create: { userId } },
        },
        include,
      });
      await analytics(tx, userId, "event_created", { eventId: e.id });
      return eventDto(e, userId);
    });
  }
  async update(userId: string, id: string, body: unknown) {
    const d = parse(eventInput, body);
    this.validateDates(d);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${id}::uuid FOR UPDATE`;
      const e = await this.accessible(id, userId, tx);
      if (e.creatorId !== userId)
        fail(403, "FORBIDDEN", "Only the organizer can edit");
      if (d.capacity < e.participants.length)
        fail(409, "CAPACITY_TOO_SMALL", "Capacity below joined count");
      const updated = await tx.event.update({
        where: { id },
        data: {
          ...d,
          dateStart: new Date(d.dateStart),
          dateEnd: new Date(d.dateEnd),
        },
        include,
      });
      for (const p of e.participants)
        if (p.userId !== userId)
          await notify(
            tx,
            p.userId,
            "EVENT_UPDATED",
            { eventId: id, title: `Изменение: ${d.title}` },
            `updated:${id}:${updated.updatedAt.toISOString()}:${p.userId}`,
          );
      return eventDto(updated, userId);
    });
  }
  async cancel(userId: string, id: string, asAdmin = false) {
    parse(uuid, id);
    return this.db.$transaction(async (tx) => {
      const e = asAdmin
        ? await tx.event.findUnique({ where: { id }, include })
        : await this.accessible(id, userId, tx);
      if (!e) fail(404, "EVENT_UNAVAILABLE", "Event unavailable");
      if (asAdmin)
        await tx.moderationAction.create({
          data: {
            actorId: userId,
            targetId: id,
            action: "CANCEL_EVENT",
            reason: "Administrator event moderation",
          },
        });
      if (e.creatorId !== userId && !asAdmin)
        fail(403, "FORBIDDEN", "Only the organizer can cancel");
      await tx.event.update({ where: { id }, data: { isCancelled: true } });
      await tx.eventParticipant.updateMany({
        where: { eventId: id },
        data: { status: "CANCELLED" },
      });
      for (const p of e.participants)
        await notify(
          tx,
          p.userId,
          "EVENT_UPDATED",
          { eventId: id, title: `Отменено: ${e.title}` },
          `cancel:${id}:${p.userId}`,
        );
      return { cancelled: true };
    });
  }
  async participate(userId: string, id: string, join: boolean) {
    parse(uuid, id);
    await adult(this.db, userId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.event.findUniqueOrThrow({
        where: { id },
        select: { creatorId: true },
      });
      const pair = [userId, row.creatorId].sort().join(":");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pair},0))`;
      const e = await this.accessible(id, userId, tx);
      if (e.dateStart <= new Date())
        fail(409, "EVENT_STARTED", "Event already started");
      if (e.creatorId === userId && !join)
        fail(409, "HOST_CANNOT_LEAVE", "Cancel your event instead");
      const existing = e.participants.some((p: any) => p.userId === userId);
      if (existing === join) return eventDto(e, userId);
      if (join && e.participants.length >= e.capacity)
        fail(409, "EVENT_FULL", "Event has reached capacity");
      await tx.eventParticipant.upsert({
        where: { eventId_userId: { eventId: id, userId } },
        create: { eventId: id, userId, status: join ? "JOINED" : "LEFT" },
        update: { status: join ? "JOINED" : "LEFT" },
      });
      await analytics(tx, userId, join ? "event_joined" : "event_left", {
        eventId: id,
      });
      if (join && userId !== e.creatorId)
        await notify(
          tx,
          e.creatorId,
          "EVENT_JOINED",
          { eventId: id, title: `Новый участник: ${e.title}` },
          `join:${id}:${userId}`,
        );
      return eventDto(
        await tx.event.findUniqueOrThrow({ where: { id }, include }),
        userId,
      );
    });
  }
}
@Controller("events")
@UseGuards(AuthGuard)
export class EventsController {
  constructor(
    private service: EventsService,
    private db: Db,
  ) {}
  @Get() list(@Req() r: AuthRequest, @Query() q: unknown) {
    return this.service.list(r.user.id, q);
  }
  @Post() create(@Req() r: AuthRequest, @Body() b: unknown) {
    return this.service.create(r.user.id, b);
  }
  @Get(":id") detail(@Req() r: AuthRequest, @Param("id") id: string) {
    return this.service.detail(r.user.id, id);
  }
  @Patch(":id") update(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    parse(uuid, id);
    return this.service.update(r.user.id, id, b);
  }
  @Delete(":id") cancel(@Req() r: AuthRequest, @Param("id") id: string) {
    return this.service.cancel(r.user.id, id);
  }
  @Post(":id/join") join(@Req() r: AuthRequest, @Param("id") id: string) {
    return this.service.participate(r.user.id, id, true);
  }
  @Post(":id/leave") leave(@Req() r: AuthRequest, @Param("id") id: string) {
    return this.service.participate(r.user.id, id, false);
  }
  @Post(":id/save") async save(@Req() r: AuthRequest, @Param("id") id: string) {
    await adult(this.db, r.user.id);
    await this.service.accessible(id, r.user.id);
    await this.db.savedEvent.upsert({
      where: { userId_eventId: { userId: r.user.id, eventId: id } },
      create: { userId: r.user.id, eventId: id },
      update: {},
    });
    await analytics(this.db, r.user.id, "event_saved", { eventId: id });
    return { saved: true };
  }
  @Delete(":id/save") async unsave(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    parse(uuid, id);
    await this.db.savedEvent.deleteMany({
      where: { eventId: id, userId: r.user.id },
    });
    return { saved: false };
  }
  @Post(":id/confirm") async confirm(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const e = await this.service.accessible(id, r.user.id);
    if (e.dateEnd > new Date())
      fail(409, "EVENT_NOT_ENDED", "Confirm after the event");
    const p = await this.db.eventParticipant.findUnique({
      where: { eventId_userId: { eventId: id, userId: r.user.id } },
    });
    if (!p || p.status !== "JOINED")
      fail(403, "NOT_PARTICIPANT", "Participants only");
    await this.db.eventParticipant.update({
      where: { eventId_userId: { eventId: id, userId: r.user.id } },
      data: { confirmedAt: p.confirmedAt ?? new Date() },
    });
    return { confirmed: true };
  }
  @Get(":id/participants") async participants(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    await adult(this.db, r.user.id);
    const e = await this.service.accessible(id, r.user.id);
    const blocked = await excluded(this.db, r.user.id);
    const users = await this.db.user.findMany({
      where: {
        id: { in: e.participants.map((p: any) => p.userId), notIn: blocked },
        isActive: true,
        isBlocked: false,
        profile: { isHidden: false },
      },
      include: userInclude,
      take: 100,
    });
    return { items: users.map((u) => publicUser(u)), nextCursor: null };
  }
}
