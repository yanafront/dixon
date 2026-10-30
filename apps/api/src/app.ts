import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { TelegramSetup, telegramState } from "./telegram-setup";
import { LoggerModule } from "nestjs-pino";
import { z } from "zod";
import {
  Db,
  AuthService,
  AuthGuard,
  AuthRequest,
  ErrorFilter,
  parse,
  rate,
  fail,
} from "./core";
import { UsersService, UsersController } from "./users";
import { EventsService, EventsController } from "./events";
import { DiscoveryService, DiscoveryController } from "./discovery";
import { SafetyController } from "./safety";
import { MediaService, MediaController } from "./media";
import { ClubsController } from "./clubs";
import {
  NotificationsController,
  TelegramController,
  AnalyticsController,
  Worker,
} from "./notifications";
@Controller()
class PublicController {
  constructor(
    private db: Db,
    private auth: AuthService,
    private users: UsersService,
  ) {}
  @Get("auth/config") config() {
    return {
      telegramBotUsername: telegramState.username,
      telegramConfigured: telegramState.configured,
    };
  }
  @Get("auth/me") @UseGuards(AuthGuard) me(@Req() r: AuthRequest) {
    return this.users.me(r.user.id);
  }
  @Get("users/me/saved-events") @UseGuards(AuthGuard) saved(
    @Req() r: AuthRequest,
  ) {
    return this.db.savedEvent.findMany({
      where: { userId: r.user.id },
      select: { eventId: true },
    });
  }
  @Get("health") async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
  @Post("auth/telegram") async telegram(
    @Req() r: Request,
    @Body() body: unknown,
  ) {
    await rate(this.db, `auth:${r.ip}`, 15, 60);
    const d = parse(
      z.object({ initData: z.string().min(1).max(12000) }).strict(),
      body,
    );
    const session = await this.auth.telegram(d.initData);
    return { token: session.token, user: await this.users.me(session.userId) };
  }
  @Post("auth/dev") async dev(@Req() r: Request, @Body() body: unknown) {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.ALLOW_DEV_AUTH !== "true" ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(r.ip || "")
    )
      fail(404, "NOT_FOUND", "Unavailable");
    const d = parse(
      z.object({ telegramId: z.enum(["900001", "900002", "900003"]) }).strict(),
      body,
    );
    const { createHmac } = await import("node:crypto");
    const user = JSON.stringify({
      id: Number(d.telegramId),
      first_name: `Local ${d.telegramId.slice(-1)}`,
    });
    const p = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user,
    });
    const data = [...p.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secret = createHmac("sha256", "WebAppData")
      .update(process.env.BOT_TOKEN!)
      .digest();
    p.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
    const session = await this.auth.telegram(p.toString());
    return { token: session.token, user: await this.users.me(session.userId) };
  }
}
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body",
          "res.headers.set-cookie",
        ],
        serializers: {
          req: (r: any) => ({ method: r.method, url: r.url?.split("?")[0] }),
          res: (r: any) => ({ statusCode: r.statusCode }),
        },
      },
    }),
  ],
  controllers: [
    PublicController,
    UsersController,
    EventsController,
    DiscoveryController,
    SafetyController,
    MediaController,
    ClubsController,
    NotificationsController,
    TelegramController,
    AnalyticsController,
  ],
  providers: [
    Db,
    AuthService,
    AuthGuard,
    ErrorFilter,
    UsersService,
    EventsService,
    DiscoveryService,
    MediaService,
    Worker,
    TelegramSetup,
  ],
})
export class AppModule {}
