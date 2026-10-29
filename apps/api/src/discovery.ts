import {
  Injectable,
  Controller,
  Get,
  Post,
  Req,
  Param,
  Query,
  Body,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { modes } from "../../../packages/types/src";
import {
  Db,
  AuthRequest,
  AuthGuard,
  adult,
  age,
  excluded,
  ensureVisible,
  publicUser,
  userInclude,
  distance,
  fail,
  parse,
  rate,
} from "./core";
import { notify, analytics } from "./notifications";
const modeSchema = z.enum(modes);
@Injectable()
export class DiscoveryService {
  constructor(private db: Db) {}
  async eligible(from: string, to: string, mode: string) {
    const me = await this.db.user.findUniqueOrThrow({
      where: { id: from },
      include: userInclude,
    });
    await ensureVisible(this.db, from, to);
    const other = await this.db.user.findUniqueOrThrow({
      where: { id: to },
      include: userInclude,
    });
    if (from === to || me.profile?.isHidden)
      fail(404, "NOT_ELIGIBLE", "Unavailable");
    const hasGoal = (u: any) =>
      u.goals.some((g: any) => g.goal === mode || g.goal === "OPEN");
    if (mode !== "OPEN" && (!hasGoal(me) || !hasGoal(other)))
      fail(404, "NOT_ELIGIBLE", "Different goals");
    if (mode === "DATING") {
      if (
        !me.profile?.datingEnabled ||
        !other.profile?.datingEnabled ||
        !me.preferences ||
        !other.preferences
      )
        fail(404, "NOT_ELIGIBLE", "Dating not enabled");
      for (const [a, b] of [
        [me, other],
        [other, me],
      ]) {
        const pref = a.preferences!;
        const years = age(b.profile!.birthDate);
        if (
          years < pref.minAge ||
          years > pref.maxAge ||
          !pref.interestedInGender.includes(b.profile!.gender)
        )
          fail(404, "NOT_ELIGIBLE", "Outside preferences");
        if (
          !a.location ||
          !b.location ||
          a.location.expiresAt <= new Date() ||
          b.location.expiresAt <= new Date() ||
          distance(a.location, b.location) > pref.maxDistance
        )
          fail(404, "NOT_ELIGIBLE", "Location unavailable or outside radius");
      }
    }
    return { me, other };
  }
  async discover(id: string, q: unknown) {
    await adult(this.db, id);
    const d = parse(
      z
        .object({
          mode: modeSchema.default("SPORT"),
          radius: z.coerce.number().min(1).max(200).optional(),
        })
        .strict(),
      q,
    );
    const me = await this.db.user.findUniqueOrThrow({
      where: { id },
      include: userInclude,
    });
    const blocked = await excluded(this.db, id);
    const seen = await this.db.swipe.findMany({
      where: { fromUserId: id, mode: d.mode },
      select: { toUserId: true },
    });
    const candidates = await this.db.user.findMany({
      where: {
        id: { notIn: [id, ...blocked, ...seen.map((s) => s.toUserId)] },
        isActive: true,
        isBlocked: false,
        profile: {
          isHidden: false,
          ...(me.profile?.city ? { city: me.profile.city } : {}),
        },
      },
      include: userInclude,
      take: 200,
      orderBy: { createdAt: "desc" },
    });
    const ranked: { u: any; score: number }[] = [];
    for (const u of candidates) {
      try {
        await this.eligible(id, u.id, d.mode);
        if (d.radius) {
          if (
            !me.location ||
            !u.location ||
            me.location.expiresAt <= new Date() ||
            u.location.expiresAt <= new Date() ||
            distance(me.location, u.location) > d.radius
          )
            continue;
        }
        ranked.push({
          u,
          score:
            u.sports.filter((s) =>
              me.sports.some((m) => m.sportCode === s.sportCode),
            ).length *
              10 +
            u.goals.filter((g) => me.goals.some((m) => m.goal === g.goal))
              .length *
              3,
        });
      } catch (e) {
        if ((e as any).getStatus?.() === 404) continue;
        throw e;
      }
    }
    ranked.sort((a, b) => b.score - a.score || a.u.id.localeCompare(b.u.id));
    return {
      items: ranked.slice(0, 30).map((x) => publicUser(x.u, me.location)),
      nextCursor: null,
    };
  }
  async swipe(from: string, to: string, type: "LIKE" | "SKIP", mode: string) {
    parse(z.string().uuid(), to);
    parse(modeSchema, mode);
    await adult(this.db, from);
    await this.eligible(from, to, mode);
    await rate(this.db, `swipe:${from}`, 60, 3600);
    const [a, b] = [from, to].sort();
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${a + ":" + b},0))`;
      if (
        await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: from, blockedId: to },
              { blockerId: to, blockedId: from },
            ],
          },
        })
      )
        fail(404, "NOT_FOUND", "Unavailable");
      const key = { fromUserId: from, toUserId: to, mode };
      const existing = await tx.swipe.findUnique({
        where: { fromUserId_toUserId_mode: key },
      });
      if (!existing) {
        await tx.swipe.create({ data: { ...key, type } });
        await analytics(
          tx,
          from,
          type === "LIKE" ? "swipe_like" : "swipe_skip",
          { targetId: to, mode },
        );
      }
      const decision = existing?.type ?? type;
      const reciprocal = await tx.swipe.findUnique({
        where: {
          fromUserId_toUserId_mode: { fromUserId: to, toUserId: from, mode },
        },
      });
      let match = null;
      if (decision === "LIKE" && reciprocal?.type === "LIKE") {
        const old = await tx.match.findUnique({
          where: { userAId_userBId_mode: { userAId: a, userBId: b, mode } },
        });
        match =
          old ??
          (await tx.match.create({ data: { userAId: a, userBId: b, mode } }));
        if (!old) {
          await analytics(tx, from, "match_created", { matchId: match.id });
          for (const id of [from, to])
            await notify(
              tx,
              id,
              "MATCH",
              { matchId: match.id, title: "Вы в одном ритме. Новый мэтч!" },
              `match:${match.id}:${id}`,
            );
        }
      }
      return { type: decision, match: match?.isActive ? match : null };
    });
  }
}
@Controller()
@UseGuards(AuthGuard)
export class DiscoveryController {
  constructor(
    private db: Db,
    private service: DiscoveryService,
  ) {}
  @Get("discover") discover(@Req() r: AuthRequest, @Query() q: unknown) {
    return this.service.discover(r.user.id, q);
  }
  @Post("users/:id/like") like(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const d = parse(
      z.object({ mode: modeSchema.default("SPORT") }).strict(),
      b,
    );
    return this.service.swipe(r.user.id, id, "LIKE", d.mode);
  }
  @Post("users/:id/skip") skip(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const d = parse(
      z.object({ mode: modeSchema.default("SPORT") }).strict(),
      b,
    );
    return this.service.swipe(r.user.id, id, "SKIP", d.mode);
  }
  @Get("matches") async matches(@Req() r: AuthRequest) {
    await adult(this.db, r.user.id);
    const blocked = await excluded(this.db, r.user.id);
    const rows = await this.db.match.findMany({
      where: {
        isActive: true,
        OR: [{ userAId: r.user.id }, { userBId: r.user.id }],
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    const items = [];
    for (const m of rows) {
      const id = m.userAId === r.user.id ? m.userBId : m.userAId;
      if (blocked.includes(id)) continue;
      try {
        await ensureVisible(this.db, r.user.id, id);
      } catch {
        continue;
      }
      const u = await this.db.user.findUniqueOrThrow({
        where: { id },
        include: userInclude,
      });
      items.push({
        id: m.id,
        mode: m.mode,
        createdAt: m.createdAt,
        user: publicUser(u),
      });
    }
    return { items, nextCursor: null };
  }
  @Post("matches/:id/contact") async contact(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    parse(z.string().uuid(), id);
    await adult(this.db, r.user.id);
    const m = await this.db.match.findUnique({ where: { id } });
    if (!m || !m.isActive || ![m.userAId, m.userBId].includes(r.user.id))
      fail(404, "NOT_FOUND", "Match unavailable");
    const target = m.userAId === r.user.id ? m.userBId : m.userAId;
    await ensureVisible(this.db, r.user.id, target);
    const u = await this.db.user.findUniqueOrThrow({
      where: { id: target },
      include: { profile: true },
    });
    if (!u.telegramUsername || !u.profile?.contactConsent)
      fail(409, "CONTACT_PRIVATE", "Contact is not shared");
    return { url: `https://t.me/${u.telegramUsername}` };
  }
}
