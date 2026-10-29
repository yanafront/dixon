import { Controller, Get, Post, Req, Param, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  Db,
  AuthGuard,
  AuthRequest,
  adult,
  parse,
  fail,
  excluded,
  publicUser,
  userInclude,
} from "./core";
import { analytics } from "./notifications";
@Controller("clubs")
@UseGuards(AuthGuard)
export class ClubsController {
  constructor(private db: Db) {}
  async get(id: string, viewer: string) {
    parse(z.string().uuid(), id);
    const c = await this.db.club.findUnique({
      where: { id },
      include: { members: true, creator: true },
    });
    if (
      !c ||
      !c.creator.isActive ||
      c.creator.isBlocked ||
      (await excluded(this.db, viewer)).includes(c.creatorId)
    )
      fail(404, "NOT_FOUND", "Club unavailable");
    return c;
  }
  dto(c: any, id: string) {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      isOfficial: c.isOfficial,
      telegramChatUrl: c.members.some((m: any) => m.userId === id)
        ? c.telegramChatUrl
        : null,
      memberCount: c.members.length,
      joined: c.members.some((m: any) => m.userId === id),
    };
  }
  @Get() async list(@Req() r: AuthRequest) {
    await adult(this.db, r.user.id);
    const blocked = await excluded(this.db, r.user.id);
    const c = await this.db.club.findMany({
      where: {
        creatorId: { notIn: blocked },
        creator: { isActive: true, isBlocked: false },
      },
      include: { members: true },
      take: 100,
    });
    return { items: c.map((x) => this.dto(x, r.user.id)), nextCursor: null };
  }
  @Get(":id") async detail(@Req() r: AuthRequest, @Param("id") id: string) {
    await adult(this.db, r.user.id);
    return this.dto(await this.get(id, r.user.id), r.user.id);
  }
  @Post(":id/join") async join(@Req() r: AuthRequest, @Param("id") id: string) {
    await adult(this.db, r.user.id);
    await this.get(id, r.user.id);
    await this.db.clubMember.upsert({
      where: { clubId_userId: { clubId: id, userId: r.user.id } },
      create: { clubId: id, userId: r.user.id },
      update: {},
    });
    await analytics(this.db, r.user.id, "club_joined");
    return this.detail(r, id);
  }
  @Post(":id/leave") async leave(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const c = await this.get(id, r.user.id);
    if (c.creatorId === r.user.id)
      fail(409, "OWNER_CANNOT_LEAVE", "Club owner cannot leave");
    await this.db.clubMember.deleteMany({
      where: { clubId: id, userId: r.user.id },
    });
    return this.detail(r, id);
  }
  @Get(":id/participants") async members(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    await adult(this.db, r.user.id);
    const c = await this.get(id, r.user.id);
    const blocked = await excluded(this.db, r.user.id);
    const users = await this.db.user.findMany({
      where: {
        id: { in: c.members.map((m) => m.userId), notIn: blocked },
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
