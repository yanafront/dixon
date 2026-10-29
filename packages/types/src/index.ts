import { z } from "zod";
export const goals = [
  "SPORT",
  "FRIENDS",
  "DATING",
  "NETWORKING",
  "OUTDOOR",
  "EVENTS",
  "OPEN",
] as const;
export const sports = [
  "running",
  "cycling",
  "gym",
  "fitness",
  "hiking",
  "snowboard",
  "skiing",
  "padel",
  "tennis",
  "football",
  "basketball",
  "volleyball",
  "swimming",
  "yoga",
  "outdoor",
  "travel",
] as const;
export const modes = [
  "SPORT",
  "FRIENDS",
  "DATING",
  "NETWORKING",
  "OPEN",
] as const;
const gender = z.enum(["FEMALE", "MALE", "OTHER", "UNDISCLOSED"]);
const telegramUrl = z
  .string()
  .regex(/^https:\/\/t\.me\/(?:[A-Za-z0-9_]{5,32}|\+[A-Za-z0-9_-]{10,})$/)
  .nullable()
  .optional();
export const profileInput = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    gender,
    city: z.string().trim().min(1).max(80),
    bio: z.string().max(500),
    sportLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
    datingEnabled: z.boolean(),
    isHidden: z.boolean().default(false),
    contactConsent: z.boolean().default(false),
    goals: z.array(z.enum(goals)).min(1).max(7),
    sports: z.array(z.enum(sports)).min(1).max(16),
    preferences: z
      .object({
        interestedInGender: z.array(gender).min(1).max(4),
        minAge: z.number().int().min(18).max(100),
        maxAge: z.number().int().min(18).max(100),
        maxDistance: z.number().int().min(1).max(200),
      })
      .refine((v) => v.minAge <= v.maxAge)
      .optional(),
  })
  .strict();
export const eventInput = z
  .object({
    title: z.string().trim().min(3).max(100),
    description: z.string().max(3000),
    category: z.enum(sports),
    city: z.string().trim().min(1).max(80),
    dateStart: z.string().datetime({ offset: true }),
    dateEnd: z.string().datetime({ offset: true }),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    locationName: z.string().min(2).max(200),
    capacity: z.number().int().min(2).max(500),
    difficulty: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "ANY"]),
    price: z.number().int().min(0).max(100000).default(0),
    parameters: z
      .record(
        z.string(),
        z.union([
          z.string().max(300),
          z.number(),
          z.array(z.string().max(80)).max(20),
        ]),
      )
      .default({}),
    isPrivate: z.boolean().default(false),
    telegramChatUrl: telegramUrl,
  })
  .strict();
export const locationInput = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    statusType: z.enum(["SPORT", "SOCIAL", "DATING", "OPEN"]),
    ttlHours: z.number().int().min(1).max(24),
    audience: z.enum(["COMMUNITY", "MATCHES"]).default("COMMUNITY"),
    showDistance: z.boolean().default(false),
  })
  .strict();
export const reportInput = z
  .object({
    targetUserId: z.string().uuid().optional(),
    targetEventId: z.string().uuid().optional(),
    targetPhotoId: z.string().uuid().optional(),
    reason: z.enum(["SPAM", "HARASSMENT", "DANGER", "CONTENT", "OTHER"]),
    description: z.string().max(2000).default(""),
  })
  .strict()
  .refine(
    (v) =>
      [v.targetUserId, v.targetEventId, v.targetPhotoId].filter(Boolean)
        .length === 1,
  );
export const analyticsNames = [
  "app_open",
  "onboarding_started",
  "onboarding_completed",
  "map_opened",
  "discover_opened",
  "swipe_like",
  "swipe_skip",
  "match_created",
  "event_viewed",
  "event_created",
  "event_joined",
  "event_left",
  "event_saved",
  "club_viewed",
  "club_joined",
  "profile_viewed",
  "report_created",
  "block_created",
] as const;
export type ProfileInput = z.infer<typeof profileInput>;
export type EventInput = z.infer<typeof eventInput>;
export type PublicUser = {
  id: string;
  firstName: string;
  age: number | null;
  city: string;
  bio: string;
  gender: string;
  sportLevel: string;
  isVerified: boolean;
  sports: string[];
  goals: string[];
  photos: { id: string; url: string }[];
  distanceKm: number | null;
  location?: {
    latitude: number;
    longitude: number;
    statusType: string;
    expiresAt: string;
  } | null;
};
export type Me = PublicUser & {
  role: "USER" | "MODERATOR" | "ADMIN" | "SUPER_ADMIN";
  birthDate: string | null;
  datingEnabled: boolean;
  isHidden: boolean;
  contactConsent: boolean;
  preferences: ProfileInput["preferences"] | null;
  botOptIn: boolean;
};
export type EventDto = EventInput & {
  id: string;
  creatorId: string;
  creator: { id: string; firstName: string; isVerified: boolean };
  participantCount: number;
  joined: boolean;
  saved: boolean;
  isCancelled: boolean;
  isOfficial: boolean;
};
export type MatchDto = {
  id: string;
  mode: string;
  createdAt: string;
  user: PublicUser;
};
export type ClubDto = {
  id: string;
  name: string;
  description: string;
  isOfficial: boolean;
  telegramChatUrl: string | null;
  memberCount: number;
  joined: boolean;
};
export type NotificationDto = {
  id: string;
  type: string;
  payload: { title?: string; eventId?: string; matchId?: string };
  readAt: string | null;
  createdAt: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ApiError = {
  error: { code: string; message: string; requestId?: string };
};
