import {
  Injectable,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Req,
  Param,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { profileInput, locationInput } from "../../../packages/types/src";
import {
  Db,
  AuthGuard,
  AuthRequest,
  adult,
  age,
  parse,
  fail,
  excluded,
  ensureVisible,
  publicUser,
  userInclude,
  rate,
} from "./core";
import { MediaService } from "./media";
@Injectable()
export class UsersService {
  constructor(
    private db: Db,
    private media: MediaService,
  ) {}
  async me(id: string) {
    const u = await this.db.user.findUniqueOrThrow({
      where: { id },
      include: userInclude,
    });
    return {
      ...publicUser(u),
      role: u.role,
      birthDate: u.profile?.birthDate.toISOString().slice(0, 10) ?? null,
      datingEnabled: u.profile?.datingEnabled ?? false,
      isHidden: u.profile?.isHidden ?? false,
      contactConsent: u.profile?.contactConsent ?? false,
      preferences: u.preferences,
      botOptIn: u.botOptIn,
    };
  }
  async update(id: string, body: unknown) {
    const d = parse(profileInput, body);
    const birth = new Date(d.birthDate + "T00:00:00Z");
    if (
      !Number.isFinite(+birth) ||
      birth.toISOString().slice(0, 10) !== d.birthDate ||
      age(birth) < 18 ||
      age(birth) > 110
    )
      fail(422, "AGE_RESTRICTED", "Available to adults 18+");
    if (d.datingEnabled && !d.preferences)
      fail(422, "PREFERENCES_REQUIRED", "Dating preferences required");
    await rate(this.db, `profile:${id}`, 30, 3600);
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { firstName: d.firstName } });
      const data = {
        birthDate: birth,
        gender: d.gender,
        city: d.city,
        bio: d.bio,
        sportLevel: d.sportLevel,
        datingEnabled: d.datingEnabled,
        isHidden: d.isHidden,
        contactConsent: d.contactConsent,
      };
      await tx.profile.upsert({
        where: { userId: id },
        create: { userId: id, ...data },
        update: data,
      });
      await tx.userGoal.deleteMany({ where: { userId: id } });
      await tx.userGoal.createMany({
        data: [...new Set(d.goals)].map((goal) => ({ userId: id, goal })),
      });
      await tx.userSportInterest.deleteMany({ where: { userId: id } });
      await tx.userSportInterest.createMany({
        data: [...new Set(d.sports)].map((sportCode) => ({
          userId: id,
          sportCode,
        })),
      });
      if (d.preferences)
        await tx.datingPreferences.upsert({
          where: { userId: id },
          create: { userId: id, ...d.preferences },
          update: d.preferences,
        });
      if (d.isHidden || !d.datingEnabled)
        await tx.locationStatus.deleteMany({
          where: {
            userId: id,
            ...(!d.isHidden ? { statusType: "DATING" } : {}),
          },
        });
    });
    return this.me(id);
  }
  async nearby(id: string) {
    const viewer = await adult(this.db, id);
    const blocked = await excluded(this.db, id);
    const u = await this.db.user.findMany({
      where: {
        id: { notIn: [id, ...blocked] },
        isActive: true,
        isBlocked: false,
        profile: { isHidden: false, city: viewer.city },
        location: { expiresAt: { gt: new Date() } },
      },
      include: userInclude,
      take: 100,
    });
    const matches = await this.db.match.findMany({
      where: { isActive: true, OR: [{ userAId: id }, { userBId: id }] },
    });
    const matched = new Set(
      matches.map((m) => (m.userAId === id ? m.userBId : m.userAId)),
    );
    return {
      items: u
        .filter(
          (x) =>
            x.profile &&
            age(x.profile.birthDate) >= 18 &&
            (x.location?.audience !== "MATCHES" || matched.has(x.id)),
        )
        .map((x) => ({
          ...publicUser(x),
          location: {
            latitude: x.location!.publicLatitude,
            longitude: x.location!.publicLongitude,
            statusType: x.location!.statusType,
            expiresAt: x.location!.expiresAt,
          },
        })),
      nextCursor: null,
    };
  }
  async remove(id: string) {
    await this.db.$transaction(async (tx) => {
      const photos = await tx.userPhoto.findMany({ where: { userId: id } });
      await tx.outbox.deleteMany({
        where: { kind: "ANALYTICS", payload: { path: ["userId"], equals: id } },
      });
      for (const p of photos)
        await tx.outbox.upsert({
          where: { dedupeKey: `delete:${p.storageKey}` },
          create: {
            kind: "DELETE_MEDIA",
            payload: { key: p.storageKey },
            dedupeKey: `delete:${p.storageKey}`,
          },
          update: {},
        });
      await tx.outbox.updateMany({
        where: {
          kind: "TELEGRAM",
          processedAt: null,
          payload: { path: ["userId"], equals: id },
        },
        data: { processedAt: new Date() },
      });
      await tx.swipe.deleteMany({
        where: { OR: [{ fromUserId: id }, { toUserId: id }] },
      });
      await tx.match.deleteMany({
        where: { OR: [{ userAId: id }, { userBId: id }] },
      });
      await tx.block.deleteMany({
        where: { OR: [{ blockerId: id }, { blockedId: id }] },
      });
      await tx.analyticsEvent.deleteMany({ where: { userId: id } });
      await tx.report.deleteMany({
        where: {
          OR: [
            { reporterId: id },
            { targetUserId: id },
            { targetPhotoId: { in: photos.map((p) => p.id) } },
          ],
        },
      });
      await tx.user.delete({ where: { id } });
    });
    return { deleted: true };
  }
}
@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private db: Db,
    private users: UsersService,
  ) {}
  @Get("me") me(@Req() r: AuthRequest) {
    return this.users.me(r.user.id);
  }
  @Patch("me") update(@Req() r: AuthRequest, @Body() b: unknown) {
    return this.users.update(r.user.id, b);
  }
  @Delete("me") remove(@Req() r: AuthRequest) {
    return this.users.remove(r.user.id);
  }
  @Get("nearby") nearby(@Req() r: AuthRequest) {
    return this.users.nearby(r.user.id);
  }
  @Get("me/location-status") async ownLocation(@Req() r: AuthRequest) {
    return this.db.locationStatus.findFirst({
      where: { userId: r.user.id, expiresAt: { gt: new Date() } },
    });
  }
  @Put("me/location-status") async location(
    @Req() r: AuthRequest,
    @Body() b: unknown,
  ) {
    const p = await adult(this.db, r.user.id);
    const d = parse(locationInput, b);
    if (p.isHidden)
      fail(403, "HIDDEN_PROFILE", "Make your profile visible first");
    if (d.statusType === "DATING" && !p.datingEnabled)
      fail(403, "DATING_DISABLED", "Enable dating first");
    return this.db.locationStatus.upsert({
      where: { userId: r.user.id },
      create: {
        userId: r.user.id,
        publicLatitude: Math.round(d.latitude / 0.02) * 0.02,
        publicLongitude: Math.round(d.longitude / 0.03) * 0.03,
        statusType: d.statusType,
        audience: d.audience,
        showDistance: d.showDistance,
        expiresAt: new Date(Date.now() + d.ttlHours * 3600000),
      },
      update: {
        publicLatitude: Math.round(d.latitude / 0.02) * 0.02,
        publicLongitude: Math.round(d.longitude / 0.03) * 0.03,
        statusType: d.statusType,
        audience: d.audience,
        showDistance: d.showDistance,
        expiresAt: new Date(Date.now() + d.ttlHours * 3600000),
      },
    });
  }
  @Delete("me/location-status") async hide(@Req() r: AuthRequest) {
    await this.db.locationStatus.deleteMany({ where: { userId: r.user.id } });
    return { hidden: true };
  }
  @Get(":id") async user(@Req() r: AuthRequest, @Param("id") id: string) {
    parse(z.string().uuid(), id);
    await adult(this.db, r.user.id);
    await ensureVisible(this.db, r.user.id, id);
    const u = await this.db.user.findUniqueOrThrow({
      where: { id },
      include: userInclude,
    });
    return publicUser(u);
  }
}
