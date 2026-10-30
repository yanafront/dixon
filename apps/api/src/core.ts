import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  HttpException,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  CanActivate,
  ExecutionContext,
} from "@nestjs/common";
import { PrismaClient, User } from "@prisma/client";
import {
  createHmac,
  timingSafeEqual,
  randomBytes,
  createHash,
} from "node:crypto";
import { z, ZodError } from "zod";
import * as Sentry from "@sentry/node";
import type { Request } from "express";
export type AuthRequest = Request & { user: User };
export function fail(status: number, code: string, message: string): never {
  throw new HttpException({ error: { code, message } }, status);
}
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  return schema.parse(value);
}
export function age(birth: Date, now = new Date()) {
  let a = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() &&
      now.getUTCDate() < birth.getUTCDate())
  )
    a--;
  return a;
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function validateInitData(
  raw: string,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
) {
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length)
    fail(401, "AUTH_INVALID", "Invalid Telegram data");
  const signature = params.get("hash");
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature))
    fail(401, "AUTH_INVALID", "Invalid Telegram signature");
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(calculated, Buffer.from(signature, "hex")))
    fail(401, "AUTH_INVALID", "Invalid Telegram signature");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || now - authDate > 300 || authDate > now + 30)
    fail(401, "AUTH_EXPIRED", "Reopen the Mini App");
  let data;
  try {
    data = JSON.parse(params.get("user") || "null");
  } catch {
    fail(401, "AUTH_INVALID", "Invalid Telegram user");
  }
  const result = z
    .object({
      id: z.number().int().positive().safe(),
      first_name: z.string().min(1).max(100),
      last_name: z.string().max(100).optional(),
      username: z
        .string()
        .regex(/^[A-Za-z0-9_]{5,32}$/)
        .optional(),
      allows_write_to_pm: z.boolean().optional(),
    })
    .safeParse(data);
  if (!result.success) fail(401, "AUTH_INVALID", "Invalid Telegram user");
  return result.data;
}
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
@Injectable()
export class AuthService {
  constructor(private db: Db) {}
  async telegram(raw: string) {
    const u = validateInitData(raw, process.env.BOT_TOKEN!);
    const role = process.env.ADMIN_TELEGRAM_IDS?.split(",").includes(
      String(u.id),
    )
      ? ("ADMIN" as const)
      : undefined;
    const user = await this.db.user.upsert({
      where: { telegramId: String(u.id) },
      create: {
        telegramId: String(u.id),
        firstName: u.first_name,
        lastName: u.last_name,
        telegramUsername: u.username,
        botOptIn: u.allows_write_to_pm ?? false,
        ...(role ? { role } : {}),
      },
      update: {
        telegramUsername: u.username ?? null,
      },
    });
    if (user.isBlocked || !user.isActive)
      fail(403, "ACCOUNT_DISABLED", "Account unavailable");
    const token = randomBytes(32).toString("base64url");
    await this.db.session.create({
      data: {
        userId: user.id,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 12 * 3600000),
      },
    });
    return { token, userId: user.id };
  }
  async fromToken(token: string) {
    const session = await this.db.session.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !session.user.isActive ||
      session.user.isBlocked
    )
      fail(401, "SESSION_INVALID", "Open the app again");
    return session.user;
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private auth: AuthService,
    private db: Db,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token) fail(401, "AUTH_REQUIRED", "Open from Telegram");
    req.user = await this.auth.fromToken(token);
    await rate(this.db, `user:${req.user.id}`, 180, 60);
    return true;
  }
}
export async function adult(db: Db, id: string) {
  const p = await db.profile.findUnique({ where: { userId: id } });
  if (!p || age(p.birthDate) < 18)
    fail(403, "ONBOARDING_REQUIRED", "Complete your 18+ profile");
  return p;
}
export function adminRole(user: User, write = false) {
  const roles = write
    ? ["ADMIN", "SUPER_ADMIN"]
    : ["MODERATOR", "ADMIN", "SUPER_ADMIN"];
  if (!roles.includes(user.role))
    fail(403, "FORBIDDEN", "Insufficient permissions");
}
export async function rate(
  db: Db,
  key: string,
  limit: number,
  seconds: number,
) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const bucket = await db.rateBucket.upsert({
    where: { key: `${key}:${window}` },
    create: {
      key: `${key}:${window}`,
      expiresAt: new Date((window + 1) * seconds * 1000),
    },
    update: { count: { increment: 1 } },
  });
  if (bucket.count > limit) fail(429, "RATE_LIMIT", "Try again later");
}
export async function excluded(db: Db, id: string) {
  const b = await db.block.findMany({
    where: { OR: [{ blockerId: id }, { blockedId: id }] },
  });
  return b.map((x) => (x.blockerId === id ? x.blockedId : x.blockerId));
}
export async function ensureVisible(db: Db, viewer: string, target: string) {
  target = target.toLowerCase();
  if (viewer === target) return;
  const u = await db.user.findUnique({
    where: { id: target },
    include: { profile: true },
  });
  if (
    !u ||
    u.isBlocked ||
    !u.isActive ||
    !u.profile ||
    u.profile.isHidden ||
    age(u.profile.birthDate) < 18 ||
    (await excluded(db, viewer)).includes(target)
  )
    fail(404, "NOT_FOUND", "Profile unavailable");
}
export function distance(
  a: { publicLatitude: number; publicLongitude: number },
  b: { publicLatitude: number; publicLongitude: number },
) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dlat = rad(b.publicLatitude - a.publicLatitude),
    dlon = rad(b.publicLongitude - a.publicLongitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.publicLatitude)) *
      Math.cos(rad(b.publicLatitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function publicUser(u: any, origin?: any) {
  const live =
    u.location && u.location.expiresAt > new Date() ? u.location : null;
  return {
    id: u.id,
    firstName: u.firstName,
    age: u.profile ? age(u.profile.birthDate) : null,
    city: u.profile?.city ?? "",
    bio: u.profile?.bio ?? "",
    gender: u.profile?.gender ?? "UNDISCLOSED",
    sportLevel: u.profile?.sportLevel ?? "BEGINNER",
    isVerified: u.isVerified,
    sports: u.sports?.map((s: any) => s.sportCode) ?? [],
    goals: u.goals?.map((g: any) => g.goal) ?? [],
    photos: u.photos?.map((p: any) => ({ id: p.id, url: p.url })) ?? [],
    distanceKm:
      origin && live && live.showDistance && live.audience === "COMMUNITY"
        ? Math.ceil(distance(origin, live) / 3) * 3
        : null,
  };
}
export const userInclude = {
  profile: true,
  photos: { orderBy: { sortOrder: "asc" as const } },
  goals: true,
  sports: true,
  preferences: true,
  location: true,
};
@Injectable()
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (error instanceof HttpException && error.getStatus() === 401)
      console.warn(JSON.stringify({ level: "warn", event: "auth_failure" }));
    if (error instanceof HttpException)
      return res.status(error.getStatus()).json(error.getResponse());
    if (error instanceof ZodError)
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the submitted fields",
        },
      });
    if ((error as any)?.code === "P2025")
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Resource unavailable" },
      });
    if ((error as any)?.code === "P2002")
      return res
        .status(409)
        .json({ error: { code: "CONFLICT", message: "Already exists" } });
    Sentry.captureException(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "request_failed",
        kind: (error as any)?.constructor?.name,
      }),
    );
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Что-то пошло не так. Попробуйте ещё раз.",
      },
    });
  }
}
