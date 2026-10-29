import type {
  Me,
  PublicUser,
  EventDto,
  MatchDto,
  ClubDto,
  NotificationDto,
  Page,
  ProfileInput,
  EventInput,
} from "@dixon/types";
let token: string | null = null;
export function setToken(value: string | null) {
  token = value;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base)
    throw new ApiError(
      "API_NOT_CONFIGURED",
      503,
      "Подключение к серверу ещё не настроено.",
    );
  let res: Response;
  try {
    res = await fetch(base.replace(/\/$/, "") + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body instanceof FormData
          ? {}
          : body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      0,
      "Нет связи с сервером. Попробуй ещё раз.",
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      data.error?.code || "REQUEST_FAILED",
      res.status,
      data.error?.message || "Что-то пошло не так. Попробуй ещё раз.",
    );
  return data;
}
export const api = {
  auth: (initData: string) =>
    request<{ token: string; user: Me }>("/auth/telegram", "POST", {
      initData,
    }),
  devAuth: (telegramId: string) =>
    request<{ token: string; user: Me }>("/auth/dev", "POST", { telegramId }),
  me: () => request<Me>("/users/me"),
  profile: (input: ProfileInput) => request<Me>("/users/me", "PATCH", input),
  events: (q = "") => request<Page<EventDto>>("/events" + q),
  event: (id: string) => request<EventDto>(`/events/${id}`),
  createEvent: (input: EventInput) =>
    request<EventDto>("/events", "POST", input),
  discover: (mode: string, radius?: number) =>
    request<Page<PublicUser>>(
      `/discover?mode=${mode}${radius ? `&radius=${radius}` : ""}`,
    ),
  swipe: (id: string, like: boolean, mode: string) =>
    request<{ match: { id: string } | null }>(
      `/users/${id}/${like ? "like" : "skip"}`,
      "POST",
      { mode },
    ),
  matches: () => request<Page<MatchDto>>("/matches"),
  clubs: () => request<Page<ClubDto>>("/clubs"),
  notifications: () => request<Page<NotificationDto>>("/notifications"),
  nearby: () => request<Page<PublicUser>>("/users/nearby"),
  track: (name: string) => request("/analytics", "POST", { name }),
};
