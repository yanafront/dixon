"use client";
import Script from "next/script";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Me,
  PublicUser,
  EventDto,
  ClubDto,
  ProfileInput,
  EventInput,
  Page,
} from "@dixon/types";
import { goals, sports } from "@dixon/types";
import { api, request, setToken, ApiError } from "../api/client";
import { useSession } from "./providers";
const Map = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <p role="status">Загружаем карту…</p>,
});
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        ready: () => void;
        expand: () => void;
        requestWriteAccess?: (cb: (ok: boolean) => void) => void;
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}
const labels: Record<string, string> = {
  running: "Бег",
  cycling: "Велосипед",
  gym: "Зал",
  fitness: "Фитнес",
  hiking: "Походы",
  snowboard: "Сноуборд",
  skiing: "Лыжи",
  padel: "Падел",
  tennis: "Теннис",
  football: "Футбол",
  basketball: "Баскетбол",
  volleyball: "Волейбол",
  swimming: "Плавание",
  yoga: "Йога",
  outdoor: "Outdoor",
  travel: "Путешествия",
  SPORT: "Спорт",
  FRIENDS: "Друзья",
  DATING: "Дейтинг",
  NETWORKING: "Нетворкинг",
  OUTDOOR: "Outdoor",
  EVENTS: "События",
  OPEN: "Открыт ко всему",
  ANY: "Любой уровень",
  BEGINNER: "Начинающий",
  INTERMEDIATE: "Средний",
  ADVANCED: "Продвинутый",
};
const hero =
  "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=1400&q=85";
const nav = [
  ["map", "◎", "Карта"],
  ["find", "◇", "Найти"],
  ["create", "＋", "Создать"],
  ["activities", "▤", "Активности"],
  ["profile", "♙", "Профиль"],
];
const friendly = (e: unknown) =>
  e instanceof ApiError
    ? (
        {
          EVENT_FULL: "Все места уже заняты.",
          ONBOARDING_REQUIRED: "Сначала заполни профиль.",
          CONTACT_PRIVATE: "Пользователь пока не открыл Telegram-контакт.",
          FORBIDDEN: "Для этого действия недостаточно прав.",
          AGE_RESTRICTED: "Приложение доступно с 18 лет.",
          VALIDATION_ERROR: "Проверь заполненные поля.",
          AUTH_REQUIRED: "Открой приложение через Telegram.",
          LOCATION_REQUIRED: "Сначала включи геолокацию.",
        } as Record<string, string>
      )[e.code] || e.message
    : "Что-то пошло не так. Попробуй ещё раз.";
function Status({
  loading,
  error,
  empty,
  retry,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  retry?: () => void;
}) {
  if (loading)
    return (
      <div className="empty" role="status">
        Загружаем…
      </div>
    );
  if (error)
    return (
      <div className="empty" role="alert">
        <p>{friendly(error)}</p>
        <button className="btn alt" onClick={retry}>
          Повторить
        </button>
      </div>
    );
  if (empty)
    return (
      <div className="empty">
        <h2>Твоя компания ещё впереди</h2>
        <p>Попробуй другие фильтры или создай свою активность.</p>
      </div>
    );
  return null;
}
function Modal({
  children,
  close,
}: {
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,textarea,a[href]",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      id="overlay"
      className="open"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <section
        id="sheet"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Подробности"
      >
        <button className="close" onClick={close} aria-label="Закрыть">
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
export function MovementApp({ initialTab = "home" }: { initialTab?: string }) {
  const { me, setMe } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState(initialTab);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [modal, setModal] = useState<{ type: string; data?: any } | null>(null);
  const [toast, setToast] = useState("");
  const [category, setCategory] = useState("");
  const [feed, setFeed] = useState("Все");
  const [mode, setMode] = useState("SPORT");
  const [radius, setRadius] = useState("");
  const [match, setMatch] = useState(false);
  const close = useCallback(() => setModal(null), []);
  const notify = useCallback((s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 4000);
  }, []);
  const ready = !!me?.birthDate;
  const autoLoginAttempted = useRef(false);
  const authenticate = useCallback(
    async (id?: string) => {
      setBusy(true);
      setError("");
      try {
        const init = window.Telegram?.WebApp.initData;
        const result = id ? await api.devAuth(id) : await api.auth(init || "");
        setToken(result.token);
        setMe(result.user);
        qc.clear();
        void api.track("app_open").catch(() => {});
        window.Telegram?.WebApp.ready();
        window.Telegram?.WebApp.expand();
      } catch (e) {
        setError(friendly(e));
      } finally {
        setBusy(false);
      }
    },
    [qc, setMe],
  );
  useEffect(() => {
    if (
      sdkReady &&
      window.Telegram?.WebApp.initData &&
      !me &&
      !autoLoginAttempted.current
    ) {
      autoLoginAttempted.current = true;
      void authenticate();
    }
  }, [sdkReady, authenticate, me]);
  const authOnce = useRef(false);
  useEffect(() => {
    if (me && !ready && !authOnce.current) {
      authOnce.current = true;
      void api.track("onboarding_started").catch(() => {});
    }
  }, [me, ready]);
  const refresh = useCallback(() => {
    void qc.invalidateQueries();
  }, [qc]);
  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e) => notify(friendly(e)),
  });
  const run = (fn: () => Promise<unknown>) =>
    action.mutateAsync(fn).catch(() => undefined);
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (feed === "Мои") query.set("joined", "true");
  if (feed === "Сохранённые") query.set("saved", "true");
  if (feed === "Сегодня")
    query.set(
      "date",
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Minsk",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
  const events = useQuery({
    queryKey: ["events", query.toString()],
    queryFn: () => api.events("?" + query.toString()),
    enabled: ready,
  });
  const discovery = useQuery({
    queryKey: ["discover", mode, radius],
    queryFn: () => api.discover(mode, radius ? +radius : undefined),
    enabled: ready && tab === "find",
  });
  const nearby = useQuery({
    queryKey: ["nearby"],
    queryFn: api.nearby,
    enabled: ready && tab === "map",
    refetchInterval: 30000,
  });
  const clubs = useQuery({
    queryKey: ["clubs"],
    queryFn: api.clubs,
    enabled: ready,
  });
  const matches = useQuery({
    queryKey: ["matches"],
    queryFn: api.matches,
    enabled: ready && (modal?.type === "matches" || tab === "profile"),
  });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    enabled: ready && modal?.type === "notifications",
  });
  const showEvent = useCallback((data: EventDto) => {
    setModal({ type: "event", data });
    void api.track("event_viewed").catch(() => {});
  }, []);
  const showUser = useCallback((data: PublicUser) => {
    setModal({ type: "person", data });
    void api.track("profile_viewed").catch(() => {});
  }, []);
  const go = (next: string) => {
    setTab(next);
    if (next === "map" || next === "find")
      void api
        .track(next === "map" ? "map_opened" : "discover_opened")
        .catch(() => {});
    window.scrollTo(0, 0);
  };
  const eventCard = (e: EventDto) => (
    <article key={e.id} className="event">
      <button
        className={"event-photo category-cover " + e.category}
        style={{ width: "100%", display: "block", textAlign: "left" }}
        onClick={() => showEvent(e)}
        aria-label={e.title}
      >
        <span className="sport-glyph">
          {e.category === "running"
            ? "↗"
            : e.category === "cycling"
              ? "◎"
              : "△"}
        </span>
        <span className={"badge " + (e.isOfficial ? "official" : "")}>
          {e.isOfficial ? "DIXON OFFICIAL ↗" : labels[e.category]}
        </span>
      </button>
      <div className="event-body">
        <div className="event-time">
          {new Date(e.dateStart).toLocaleDateString("ru", {
            day: "numeric",
            month: "short",
            timeZone: "Europe/Minsk",
          })}{" "}
          ·{" "}
          {new Date(e.dateStart).toLocaleTimeString("ru", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Minsk",
          })}
        </div>
        <button className="card-title" onClick={() => showEvent(e)}>
          <h3>{e.title}</h3>
        </button>
        <p>⌖ {e.locationName}</p>
        <p>
          {labels[e.difficulty]} · {e.creator.firstName}
        </p>
        <div className="event-foot">
          <span>
            {e.participantCount}/{e.capacity} участников
          </span>
          <button
            disabled={action.isPending}
            onClick={() =>
              run(() =>
                request(`/events/${e.id}/save`, e.saved ? "DELETE" : "POST"),
              )
            }
            aria-label={e.saved ? "Убрать из сохранённых" : "Сохранить"}
          >
            {e.saved ? "♥ Сохранено" : "♡ Сохранить"}
          </button>
        </div>
      </div>
    </article>
  );
  const list = (
    <>
      <Status
        loading={events.isPending}
        error={events.error}
        empty={events.data?.items.length === 0}
        retry={() => events.refetch()}
      />
      <div className="events">{events.data?.items.map(eventCard)}</div>
    </>
  );
  const filters = (
    <div className="chips">
      {["", "running", "cycling", "hiking", "yoga", "padel"].map((s) => (
        <button
          key={s}
          className={"chip " + (s === category ? "selected" : "")}
          onClick={() => setCategory(s)}
        >
          {labels[s] || "Все"}
        </button>
      ))}
    </div>
  );
  const sidebar = (
    <aside className="right-column">
      <section>
        <div className="right-head">Город в движении ↗</div>
        <button
          className="map-preview"
          style={{ width: "100%" }}
          onClick={() => go("map")}
        >
          <div className="map-art" />
          <div className="river" />
          <span className="map-name">МИНСК</span>
          <span className="map-go">Открыть карту людей и активностей ↗</span>
        </button>
        <p className="subtle">Общий интерес — лучший повод познакомиться.</p>
      </section>
      <section>
        <div className="club">
          <div className="label">СИЛЬНЕЕ ВМЕСТЕ</div>
          <h3>
            СВОЙ ТЕМП.
            <br />
            СВОИ ЛЮДИ.
          </h3>
          <p>Находи клуб и двигайся вместе.</p>
          <button onClick={() => setModal({ type: "clubs" })}>
            Клубы сообщества ↗
          </button>
        </div>
      </section>
    </aside>
  );
  let content: React.ReactNode = null;
  if (!me)
    content = (
      <div className="empty auth">
        <span className="label">COMMUNITY FIRST</span>
        <h2>
          Свои люди.
          <br />В движении.
        </h2>
        <p>
          Открой DIXON через Telegram,
          <br />
          чтобы войти в свой аккаунт.
        </p>
        {error && (
          <p role="alert" className="red-text">
            {error}
          </p>
        )}
        <button
          className="btn"
          disabled={busy || !sdkReady}
          onClick={() => authenticate()}
        >
          {busy ? "Проверяем Telegram…" : "Войти через Telegram →"}
        </button>
        {process.env.NODE_ENV === "development" && (
          <div style={{ marginTop: 25 }}>
            <p className="subtle">
              Только локальная разработка. Сервер должен разрешать
              ALLOW_DEV_AUTH.
            </p>
            {["900001", "900002", "900003"].map((id, i) => (
              <button
                key={id}
                className="chip"
                disabled={busy}
                onClick={() => authenticate(id)}
              >
                Local {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  else if (!ready)
    content = (
      <>
        <h1>Начнём с тебя.</h1>
        <ProfileForm
          me={me}
          done={(m) => {
            setMe(m);
            void api.track("onboarding_completed").catch(() => {});
          }}
        />
      </>
    );
  else if (tab === "home" || tab === "activities")
    content = (
      <>
        {tab === "home" && (
          <section className="hero">
            <img src={hero} alt="Бег в городе" />
            <div className="hero-index">01 / COMMUNITY FIRST</div>
            <div className="hero-copy">
              <span className="label">ВЫХОДИ В ГОРОД. НАХОДИ СВОИХ.</span>
              <h2>
                ХОРОШИЕ ПЛАНЫ
                <br />
                НАЧИНАЮТСЯ
                <br />С ЛЮДЕЙ.
              </h2>
              <p>
                Пробежка, новый маршрут или просто кофе после.
                <br />
                Твоя компания уже где-то рядом.
              </p>
              <button className="btn" onClick={() => go("find")}>
                Найти своих ↗
              </button>
            </div>
          </section>
        )}
        <div className="content-grid">
          <section>
            <div className="section-head">
              <h2>
                Есть план <small>на ближайшие дни</small>
              </h2>
              <button onClick={() => go("create")}>Создать ↗</button>
            </div>
            <div className="chips">
              {["Все", "Сегодня", "Мои", "Сохранённые"].map((t) => (
                <button
                  key={t}
                  className={"chip " + (feed === t ? "red" : "")}
                  onClick={() => setFeed(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {filters}
            {list}
          </section>
          {sidebar}
        </div>
      </>
    );
  else if (tab === "map")
    content = (
      <>
        <Status
          loading={nearby.isPending || events.isPending}
          error={nearby.error || events.error}
          retry={() => {
            nearby.refetch();
            events.refetch();
          }}
        />
        {nearby.data && events.data && (
          <Map
            users={nearby.data.items}
            events={events.data.items}
            onEvent={showEvent}
            onUser={showUser}
          />
        )}
        <h2>Активности рядом</h2>
        {list}
      </>
    );
  else if (tab === "find") {
    const p = discovery.data?.items[0];
    content = (
      <>
        <div className="chips">
          {["SPORT", "FRIENDS", "DATING", "NETWORKING", "OPEN"].map((m) => (
            <button
              key={m}
              className={"chip " + (m === mode ? "selected" : "")}
              onClick={() => setMode(m)}
            >
              {labels[m]}
            </button>
          ))}
          <select
            aria-label="Радиус поиска"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          >
            <option value="">Весь город</option>
            {[5, 10, 25, 50].map((r) => (
              <option key={r} value={r}>
                {r} км
              </option>
            ))}
          </select>
        </div>
        {mode === "DATING" && !me.datingEnabled ? (
          <div className="empty">
            <h2>Знакомства — по твоему выбору</h2>
            <p>Включи dating и укажи предпочтения в профиле.</p>
            <button
              className="btn"
              onClick={() => setModal({ type: "profile" })}
            >
              Настроить профиль
            </button>
          </div>
        ) : (
          <>
            <Status
              loading={discovery.isPending}
              error={discovery.error}
              empty={discovery.data?.items.length === 0}
              retry={() => discovery.refetch()}
            />
            {p && (
              <PersonCard
                person={p}
                pending={action.isPending}
                like={async (like) => {
                  const result = (await run(() =>
                    api.swipe(p.id, like, mode),
                  )) as { match?: unknown } | undefined;
                  if (result?.match) setMatch(true);
                }}
                open={() => showUser(p)}
              />
            )}
          </>
        )}
        <button className="text" onClick={() => go("activities")}>
          Познакомиться через активность ↗
        </button>
      </>
    );
  } else if (tab === "create")
    content = (
      <CreateForm
        done={(e) => {
          refresh();
          showEvent(e);
          setTab("activities");
        }}
      />
    );
  else if (tab === "profile")
    content = (
      <>
        <div className="profile-head">
          <div
            className="avatar"
            style={{ display: "grid", placeItems: "center" }}
          >
            {me.photos[0] ? (
              <img
                src={me.photos[0].url}
                alt="Ваше фото"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            ) : (
              me.firstName[0]
            )}
          </div>
          <div>
            <h2>
              {me.firstName}
              {me.isVerified ? " ✓" : ""}
            </h2>
            <span className="subtle">
              {me.city} · {me.age} лет
            </span>
          </div>
        </div>
        <p className="subtle">{me.bio}</p>
        <div className="chips">
          {me.sports.map((s) => (
            <span className="chip" key={s}>
              {labels[s]}
            </span>
          ))}
        </div>
        <div className="settings">
          <button onClick={() => setModal({ type: "profile" })}>
            Редактировать профиль ↗
          </button>
          <button onClick={() => setModal({ type: "photos" })}>
            Мои фотографии <span>{me.photos.length}/6 ↗</span>
          </button>
          <button onClick={() => setModal({ type: "location" })}>
            Видимость на карте ↗
          </button>
          <button
            onClick={() => {
              setFeed("Мои");
              go("activities");
            }}
          >
            Мои активности ↗
          </button>
          <button onClick={() => setModal({ type: "matches" })}>
            Мои мэтчи <span>{matches.data?.items.length ?? 0} ↗</span>
          </button>
          <button onClick={() => setModal({ type: "clubs" })}>Клубы ↗</button>
          <button onClick={() => setModal({ type: "notifications" })}>
            Уведомления ↗
          </button>
          {me.role !== "USER" && (
            <button onClick={() => setTab("admin")}>Модерация ↗</button>
          )}
          <button onClick={() => setModal({ type: "guidelines" })}>
            Правила и приватность ↗
          </button>
          <button
            className="red-text"
            onClick={() => setModal({ type: "delete" })}
          >
            Удалить профиль ×
          </button>
        </div>
      </>
    );
  else if (tab === "admin") content = <Admin />;
  const deepLink = useRef(false);
  useEffect(() => {
    if (!ready || deepLink.current) return;
    deepLink.current = true;
    const id = new URLSearchParams(location.search).get("event");
    if (id && /^[a-f0-9-]{36}$/.test(id))
      void api
        .event(id)
        .then(showEvent)
        .catch((e) => notify(friendly(e)));
  }, [ready, showEvent, notify]);
  const title =
    tab === "home"
      ? "Свои люди. В движении."
      : tab === "map"
        ? "Твой город в движении."
        : tab === "find"
          ? "Найди свой ритм."
          : tab === "create"
            ? "Собери свою компанию."
            : tab === "profile"
              ? "Твой профиль."
              : tab === "admin"
                ? "Модерация."
                : "Есть план. Присоединяйся.";
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
        onError={() => {
          setSdkReady(true);
          setError("Telegram SDK недоступен. Проверь соединение.");
        }}
      />
      <header>
        <button className="logo" onClick={() => go("home")}>
          DIXON<span>●</span>
          <small>MOVEMENT COMMUNITY</small>
        </button>
        <span className="city">◎ {me?.city || "Минск"}</span>
        <div className="header-right">
          <button
            className="icon"
            aria-label="Уведомления"
            onClick={() => setModal({ type: "notifications" })}
          >
            ♧
          </button>
          <button className="avatar" onClick={() => go("profile")}>
            {me?.firstName[0] || "↗"}
          </button>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="eyebrow">ТВОЙ ГОРОД. ТВОИ ЛЮДИ.</div>
          <nav>
            {nav.map(([key, icon, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => go(key)}
              >
                <span className="nav-icon">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="side-bottom">
            <div className="mini-wordmark">
              GO OUT.
              <br />
              GET TOGETHER.
            </div>
            <p>
              Больше жизни.
              <br />
              За пределами экрана.
            </p>
            <button
              className="text"
              onClick={() => setModal({ type: "guidelines" })}
            >
              Правила сообщества ↗
            </button>
            <span>© DIXON MOVEMENT</span>
          </div>
        </aside>
        <main>
          {ready && (
            <div className="topline">
              <div>
                <p>Встречаемся в реальной жизни · {me?.city}</p>
                <h1>{title}</h1>
              </div>
              <button
                className="status"
                onClick={() => setModal({ type: "location" })}
              >
                <span className="dot" />Я открыт к общению ↗
              </button>
            </div>
          )}
          {content}
        </main>
      </div>
      <nav id="bottomNav">
        {nav.map(([key, icon, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => go(key)}
          >
            <span className="nav-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      {toast && (
        <div id="toast" role="status" style={{ display: "block" }}>
          {toast}
        </div>
      )}
      {modal && (
        <Modal close={close}>
          {modal.type === "event" && (
            <EventDetail
              initial={modal.data}
              run={run}
              pending={action.isPending}
              report={() =>
                setModal({
                  type: "report",
                  data: { targetEventId: modal.data.id },
                })
              }
              showUser={showUser}
            />
          )}{" "}
          {modal.type === "person" && (
            <>
              <h2>
                {modal.data.firstName}, {modal.data.age}
              </h2>
              {modal.data.photos[0] && (
                <img
                  className="cover"
                  src={modal.data.photos[0].url}
                  alt={modal.data.firstName}
                />
              )}
              <p>{modal.data.bio}</p>
              <p>
                {modal.data.sports.map((s: string) => labels[s]).join(" · ")}
              </p>
              <button
                className="text"
                onClick={() =>
                  setModal({
                    type: "report",
                    data: { targetUserId: modal.data.id },
                  })
                }
              >
                Пожаловаться
              </button>
              <button
                className="btn alt"
                disabled={action.isPending}
                onClick={async () => {
                  await run(() =>
                    request("/blocks", "POST", { userId: modal.data.id }),
                  );
                  close();
                }}
              >
                Заблокировать
              </button>
            </>
          )}
          {modal.type === "profile" && me && (
            <>
              <h2>Твой профиль</h2>
              <ProfileForm
                me={me}
                done={(m) => {
                  setMe(m);
                  refresh();
                  close();
                }}
              />
            </>
          )}
          {modal.type === "photos" && me && (
            <PhotoEditor
              me={me}
              done={async () => {
                setMe(await api.me());
                refresh();
              }}
              run={run}
            />
          )}{" "}
          {modal.type === "location" && <LocationForm run={run} done={close} />}{" "}
          {modal.type === "report" && (
            <ReportForm target={modal.data} done={close} />
          )}{" "}
          {modal.type === "matches" && (
            <>
              <h2>Вы в одном ритме</h2>
              <Status
                loading={matches.isPending}
                error={matches.error}
                empty={matches.data?.items.length === 0}
                retry={() => matches.refetch()}
              />
              {matches.data?.items.map((m) => (
                <div className="report-row" key={m.id}>
                  <b>{m.user.firstName}</b>
                  <p>{m.user.sports.map((s) => labels[s]).join(" · ")}</p>
                  <div className="actions">
                    <button
                      className="btn"
                      disabled={action.isPending}
                      onClick={async () => {
                        const r = (await run(() =>
                          request<{ url: string }>(
                            `/matches/${m.id}/contact`,
                            "POST",
                          ),
                        )) as { url: string } | undefined;
                        if (r)
                          window.open(r.url, "_blank", "noopener,noreferrer");
                      }}
                    >
                      Написать
                    </button>
                    <button
                      className="btn alt"
                      onClick={() => {
                        close();
                        go("activities");
                      }}
                    >
                      Позвать на активность
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          {modal.type === "clubs" && (
            <>
              <h2>Сильнее вместе</h2>
              <Status
                loading={clubs.isPending}
                error={clubs.error}
                empty={clubs.data?.items.length === 0}
                retry={() => clubs.refetch()}
              />
              {clubs.data?.items.map((c) => (
                <div className="report-row" key={c.id}>
                  <h3>
                    {c.name}
                    {c.isOfficial ? " ✓" : ""}
                  </h3>
                  <p>
                    {c.description}
                    <br />
                    {c.memberCount} участников
                  </p>
                  <button
                    className="btn"
                    disabled={action.isPending}
                    onClick={() =>
                      run(() =>
                        request(
                          `/clubs/${c.id}/${c.joined ? "leave" : "join"}`,
                          "POST",
                        ),
                      )
                    }
                  >
                    {c.joined ? "Выйти" : "Вступить →"}
                  </button>
                  {c.telegramChatUrl && (
                    <a
                      className="text"
                      href={c.telegramChatUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Чат клуба ↗
                    </a>
                  )}
                </div>
              ))}
            </>
          )}{" "}
          {modal.type === "notifications" && (
            <>
              <h2>Уведомления</h2>
              <Status
                loading={notifications.isPending}
                error={notifications.error}
                empty={notifications.data?.items.length === 0}
                retry={() => notifications.refetch()}
              />
              {notifications.data?.items.map((n) => (
                <div className="report-row" key={n.id}>
                  <p>{n.payload.title || n.type}</p>
                  {!n.readAt && (
                    <button
                      className="text"
                      onClick={() =>
                        run(() =>
                          request(`/notifications/${n.id}/read`, "PATCH"),
                        )
                      }
                    >
                      Прочитано ✓
                    </button>
                  )}
                </div>
              ))}
              <p className="subtle">
                Для сообщений в Telegram открой бота и нажми /start. Отключить —
                /stop.
              </p>
            </>
          )}{" "}
          {modal.type === "guidelines" && (
            <>
              <h2>Хорошая компания начинается с уважения.</h2>
              <p>
                Уважай согласие и границы. Никаких домогательств, дискриминации
                и спама. Первые встречи — в публичных местах. Не делись чужими
                фотографиями, контактами и геолокацией без разрешения.
              </p>
              <h3>Ты контролируешь видимость</h3>
              <p>
                Геолокация выключена по умолчанию и имеет срок действия. Dating
                включается отдельно. Контакт Telegram раскрывается после мэтча с
                согласия владельца. Профиль можно скрыть или удалить в
                настройках.
              </p>
            </>
          )}{" "}
          {modal.type === "delete" && (
            <>
              <h2>Удалить профиль?</h2>
              <p>
                Профиль, геолокация и сессии будут удалены. Фотографии попадут в
                очередь удаления из хранилища. Действие нельзя отменить.
              </p>
              <button
                className="btn"
                disabled={action.isPending}
                onClick={async () => {
                  const result = await run(() =>
                    request("/users/me", "DELETE"),
                  );
                  if (result) {
                    setToken(null);
                    setMe(null);
                    qc.clear();
                    close();
                  }
                }}
              >
                Удалить профиль
              </button>
            </>
          )}
        </Modal>
      )}
      {match && (
        <Modal close={() => setMatch(false)}>
          <span className="event-time">ВЗАИМНЫЙ ЛАЙК</span>
          <h2>Вы в одном ритме.</h2>
          <p>Лучшее знакомство начинается с общего дела.</p>
          <button
            className="btn"
            onClick={() => {
              setMatch(false);
              go("activities");
            }}
          >
            Позвать на активность →
          </button>
        </Modal>
      )}
    </>
  );
}
function PersonCard({
  person: p,
  pending,
  like,
  open,
}: {
  person: PublicUser;
  pending: boolean;
  like: (v: boolean) => void;
  open: () => void;
}) {
  const x = useRef(0);
  return (
    <article
      className="person-card"
      onTouchStart={(e) => (x.current = e.changedTouches[0].clientX)}
      onTouchEnd={(e) => {
        const delta = e.changedTouches[0].clientX - x.current;
        if (!pending && Math.abs(delta) > 85) like(delta > 0);
      }}
    >
      {p.photos[0] ? (
        <img src={p.photos[0].url} alt={p.firstName} />
      ) : (
        <div className="person-placeholder">{p.firstName[0]}</div>
      )}
      <div className="info">
        <h2>
          {p.firstName}, {p.age}
        </h2>
        <span className="subtle">
          {p.city}
          {p.distanceKm !== null ? ` · до ${p.distanceKm} км` : ""}
        </span>
        <p>{p.bio}</p>
        <div className="chips">
          {p.sports.map((s) => (
            <span className="chip" key={s}>
              {labels[s]}
            </span>
          ))}
        </div>
        <div className="swipe-actions">
          <button
            className="btn alt"
            disabled={pending}
            onClick={() => like(false)}
          >
            × Пропустить
          </button>
          <button className="btn" disabled={pending} onClick={() => like(true)}>
            ♥ Нравится
          </button>
        </div>
        <button className="text" onClick={open}>
          Открыть профиль и безопасность ↗
        </button>
      </div>
    </article>
  );
}
function ProfileForm({ me, done }: { me: Me; done: (me: Me) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dating, setDating] = useState(me.datingEnabled);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          const input: ProfileInput = {
            firstName: String(f.get("firstName")),
            birthDate: String(f.get("birthDate")),
            gender: f.get("gender") as ProfileInput["gender"],
            city: String(f.get("city")),
            bio: String(f.get("bio")),
            sportLevel: f.get("sportLevel") as ProfileInput["sportLevel"],
            datingEnabled: dating,
            isHidden: f.has("hidden"),
            contactConsent: f.has("contact"),
            goals: f.getAll("goals") as ProfileInput["goals"],
            sports: f.getAll("sports") as ProfileInput["sports"],
            ...(dating
              ? {
                  preferences: {
                    interestedInGender: f.getAll("genders") as any,
                    minAge: Number(f.get("minAge")),
                    maxAge: Number(f.get("maxAge")),
                    maxDistance: Number(f.get("maxDistance")),
                  },
                }
              : {}),
          };
          done(await api.profile(input));
        } catch (err) {
          setError(friendly(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="firstName">Имя</label>
      <input
        id="firstName"
        name="firstName"
        defaultValue={me.firstName}
        maxLength={60}
        required
      />
      <div className="row">
        <div>
          <label htmlFor="birthDate">Дата рождения · 18+</label>
          <input
            id="birthDate"
            type="date"
            name="birthDate"
            defaultValue={me.birthDate || ""}
            required
          />
        </div>
        <div>
          <label htmlFor="gender">Пол</label>
          <select id="gender" name="gender" defaultValue={me.gender}>
            <option value="UNDISCLOSED">Не указывать</option>
            <option value="FEMALE">Женский</option>
            <option value="MALE">Мужской</option>
            <option value="OTHER">Другое</option>
          </select>
        </div>
      </div>
      <label htmlFor="city">Город</label>
      <input
        id="city"
        name="city"
        defaultValue={me.city || "Минск"}
        maxLength={80}
        required
      />
      <label htmlFor="bio">О себе</label>
      <textarea id="bio" name="bio" defaultValue={me.bio} maxLength={500} />
      <label htmlFor="sportLevel">Уровень</label>
      <select name="sportLevel" id="sportLevel" defaultValue={me.sportLevel}>
        {["BEGINNER", "INTERMEDIATE", "ADVANCED"].map((s) => (
          <option key={s} value={s}>
            {labels[s]}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>Интересы · выбери хотя бы один</legend>
        <div className="choices">
          {sports.map((s) => (
            <label className="check" key={s}>
              <input
                type="checkbox"
                name="sports"
                value={s}
                defaultChecked={me.sports.includes(s)}
              />
              {labels[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Цели · выбери хотя бы одну</legend>
        <div className="choices">
          {goals.map((g) => (
            <label className="check" key={g}>
              <input
                type="checkbox"
                name="goals"
                value={g}
                defaultChecked={me.goals.includes(g)}
              />
              {labels[g]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={dating}
          onChange={(e) => setDating(e.target.checked)}
        />
        Включить dating
      </label>
      {dating && (
        <fieldset>
          <legend>Предпочтения</legend>
          <div className="choices">
            {["FEMALE", "MALE", "OTHER", "UNDISCLOSED"].map((g) => (
              <label className="check" key={g}>
                <input
                  type="checkbox"
                  name="genders"
                  value={g}
                  defaultChecked={me.preferences?.interestedInGender.includes(
                    g as any,
                  )}
                />
                {
                  {
                    FEMALE: "Женщины",
                    MALE: "Мужчины",
                    OTHER: "Другое",
                    UNDISCLOSED: "Пол не указан",
                  }[g]
                }
              </label>
            ))}
          </div>
          <div className="row">
            <div>
              <label htmlFor="minAge">Возраст от</label>
              <input
                id="minAge"
                name="minAge"
                type="number"
                min={18}
                max={100}
                defaultValue={me.preferences?.minAge || 18}
                required
              />
            </div>
            <div>
              <label htmlFor="maxAge">До</label>
              <input
                id="maxAge"
                name="maxAge"
                type="number"
                min={18}
                max={100}
                defaultValue={me.preferences?.maxAge || 45}
                required
              />
            </div>
          </div>
          <label htmlFor="maxDistance">Максимальный радиус · км</label>
          <input
            name="maxDistance"
            id="maxDistance"
            type="number"
            min={1}
            max={200}
            defaultValue={me.preferences?.maxDistance || 25}
          />
          <p className="subtle">
            Для dating-рекомендаций обоим участникам нужна активная
            приблизительная геолокация.
          </p>
        </fieldset>
      )}
      <label className="check">
        <input name="hidden" type="checkbox" defaultChecked={me.isHidden} />
        Скрыть профиль из поиска
      </label>
      <label className="check">
        <input
          name="contact"
          type="checkbox"
          defaultChecked={me.contactConsent}
        />
        Разрешить открывать мой Telegram после мэтча
      </label>
      {error && (
        <p role="alert" className="red-text">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить профиль →"}
      </button>
    </form>
  );
}
function CreateForm({ done }: { done: (e: EventDto) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState("running");
  const [draft, setDraft] = useState<EventInput | null>(null);
  return (
    <>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          const start = new Date(String(f.get("dateStart")) + "+03:00");
          const end = new Date(String(f.get("dateEnd")) + "+03:00");
          const parameters: EventInput["parameters"] = {};
          if (f.get("distance"))
            parameters.distance_km = Number(f.get("distance"));
          if (cat === "running" && f.get("pace"))
            parameters.pace_min_km = Number(f.get("pace"));
          if (cat === "cycling" && f.get("speed"))
            parameters.speed_kmh = Number(f.get("speed"));
          if (cat === "hiking" && f.get("elevation"))
            parameters.elevation_m = Number(f.get("elevation"));
          if (!Number.isFinite(+start) || !Number.isFinite(+end))
            return setError("Проверь дату и время.");
          setDraft({
            title: String(f.get("title")),
            description: String(f.get("description")),
            category: cat as EventInput["category"],
            city: String(f.get("city")),
            dateStart: start.toISOString(),
            dateEnd: end.toISOString(),
            latitude: Number(f.get("latitude")),
            longitude: Number(f.get("longitude")),
            locationName: String(f.get("locationName")),
            capacity: Number(f.get("capacity")),
            difficulty: f.get("difficulty") as EventInput["difficulty"],
            price: Number(f.get("price")),
            parameters,
            isPrivate: false,
            telegramChatUrl: String(f.get("chat")) || null,
          });
        }}
      >
        <label htmlFor="title">Что будем делать?</label>
        <input
          id="title"
          name="title"
          placeholder="Например, лёгкая пробежка и кофе"
          minLength={3}
          maxLength={100}
          required
        />
        <div className="row">
          <div>
            <label htmlFor="category">Активность</label>
            <select
              id="category"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            >
              {sports.map((s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="difficulty">Уровень</label>
            <select id="difficulty" name="difficulty">
              {["ANY", "BEGINNER", "INTERMEDIATE", "ADVANCED"].map((d) => (
                <option key={d} value={d}>
                  {labels[d]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div>
            <label htmlFor="dateStart">Начало · время Минска</label>
            <input
              type="datetime-local"
              name="dateStart"
              id="dateStart"
              required
            />
          </div>
          <div>
            <label htmlFor="dateEnd">Окончание · время Минска</label>
            <input type="datetime-local" name="dateEnd" id="dateEnd" required />
          </div>
        </div>
        <label htmlFor="eventCity">Город</label>
        <input id="eventCity" name="city" defaultValue="Минск" required />
        <label htmlFor="locationName">Публичное место встречи</label>
        <input
          id="locationName"
          name="locationName"
          minLength={2}
          maxLength={200}
          required
        />
        <p className="subtle">
          Координаты публичного места можно скопировать из карты. Не указывай
          домашний адрес.
        </p>
        <div className="row">
          <div>
            <label htmlFor="latitude">Широта</label>
            <input
              id="latitude"
              name="latitude"
              type="number"
              min={-90}
              max={90}
              step="any"
              defaultValue={53.92}
              required
            />
          </div>
          <div>
            <label htmlFor="longitude">Долгота</label>
            <input
              id="longitude"
              name="longitude"
              type="number"
              min={-180}
              max={180}
              step="any"
              defaultValue={27.55}
              required
            />
          </div>
        </div>
        {["running", "cycling", "hiking"].includes(cat) && (
          <>
            <label htmlFor="distance">Дистанция · км</label>
            <input
              id="distance"
              name="distance"
              type="number"
              min={0.1}
              max={300}
              step="any"
            />
          </>
        )}
        {cat === "running" && (
          <>
            <label htmlFor="pace">Темп · мин/км</label>
            <input
              id="pace"
              name="pace"
              type="number"
              min={2}
              max={20}
              step="any"
            />
          </>
        )}
        {cat === "cycling" && (
          <>
            <label htmlFor="speed">Скорость · км/ч</label>
            <input
              id="speed"
              name="speed"
              type="number"
              min={1}
              max={100}
              step="any"
            />
          </>
        )}
        {cat === "hiking" && (
          <>
            <label htmlFor="elevation">Набор высоты · м</label>
            <input
              id="elevation"
              name="elevation"
              type="number"
              min={0}
              max={10000}
            />
          </>
        )}
        <div className="row">
          <div>
            <label htmlFor="capacity">Лимит, включая организатора</label>
            <input
              type="number"
              name="capacity"
              id="capacity"
              defaultValue={10}
              min={2}
              max={500}
              required
            />
          </div>
          <div>
            <label htmlFor="price">Стоимость · BYN</label>
            <input
              type="number"
              name="price"
              id="price"
              defaultValue={0}
              min={0}
              max={100000}
              required
            />
          </div>
        </div>
        <label htmlFor="description">Что нужно знать участникам?</label>
        <textarea id="description" name="description" maxLength={3000} />
        <label htmlFor="chat">Ссылка на чат Telegram · необязательно</label>
        <input id="chat" name="chat" type="url" placeholder="https://t.me/…" />
        <button className="btn" type="submit">
          Предпросмотр →
        </button>
      </form>
      {draft && (
        <Modal close={() => setDraft(null)}>
          <h2>{draft.title}</h2>
          <p>
            {draft.locationName}
            <br />
            {new Date(draft.dateStart).toLocaleString("ru", {
              timeZone: "Europe/Minsk",
            })}
            <br />
            {draft.capacity} участников ·{" "}
            {draft.price ? draft.price + " BYN" : "Бесплатно"}
          </p>
          <p>{draft.description}</p>
          {error && (
            <p role="alert" className="red-text">
              {error}
            </p>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                done(await api.createEvent(draft));
                setDraft(null);
              } catch (e) {
                setError(friendly(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Создаём…" : "Создать активность →"}
          </button>
        </Modal>
      )}
    </>
  );
}
function EventDetail({
  initial,
  run,
  pending,
  report,
  showUser,
}: {
  initial: EventDto;
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
  pending: boolean;
  report: () => void;
  showUser: (u: PublicUser) => void;
}) {
  const { me } = useSession();
  const [showMembers, setShowMembers] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const q = useQuery({
    queryKey: ["event", initial.id],
    queryFn: () => api.event(initial.id),
    initialData: initial,
  });
  const e = q.data;
  const members = useQuery({
    queryKey: ["participants", e.id],
    queryFn: () => request<Page<PublicUser>>(`/events/${e.id}/participants`),
    enabled: showMembers,
  });
  return (
    <>
      <span className="event-time">
        {labels[e.category]} ·{" "}
        {new Date(e.dateStart).toLocaleString("ru", {
          timeZone: "Europe/Minsk",
        })}
      </span>
      <h2>{e.title}</h2>
      <p>
        Организатор: {e.creator.firstName}
        {e.creator.isVerified ? " ✓" : ""}
      </p>
      <div className="facts">
        <div>
          <small>ГДЕ</small>
          {e.locationName}
        </div>
        <div>
          <small>УРОВЕНЬ</small>
          {labels[e.difficulty]}
        </div>
        <div>
          <small>УЧАСТНИКИ</small>
          {e.participantCount} из {e.capacity}
        </div>
        <div>
          <small>СТОИМОСТЬ</small>
          {e.price ? e.price + " BYN" : "Бесплатно"}
        </div>
      </div>
      <p>{e.description}</p>
      {Object.entries(e.parameters).map(([k, v]) => (
        <p className="subtle" key={k}>
          {k}: {String(v)}
        </p>
      ))}
      <button className="text" onClick={() => setShowMembers(!showMembers)}>
        Посмотреть участников ↗
      </button>
      {showMembers && (
        <>
          <Status
            loading={members.isPending}
            error={members.error}
            retry={() => members.refetch()}
          />
          {members.data?.items.map((p) => (
            <button className="chip" key={p.id} onClick={() => showUser(p)}>
              {p.firstName}
            </button>
          ))}
        </>
      )}
      <div className="actions">
        <button
          className="btn"
          disabled={pending || (!e.joined && e.participantCount >= e.capacity)}
          onClick={() =>
            run(() =>
              request(`/events/${e.id}/${e.joined ? "leave" : "join"}`, "POST"),
            )
          }
        >
          {e.joined
            ? "Выйти"
            : e.participantCount >= e.capacity
              ? "Все места заняты"
              : "Присоединиться →"}
        </button>
        <button
          className="btn alt"
          disabled={pending}
          onClick={() =>
            run(() =>
              request(`/events/${e.id}/save`, e.saved ? "DELETE" : "POST"),
            )
          }
        >
          {e.saved ? "Убрать из сохранённых" : "Сохранить"}
        </button>
        <button
          className="text"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                location.origin + "/?event=" + e.id,
              );
              setShareMessage("Ссылка скопирована");
            } catch {
              setShareMessage("Не удалось скопировать ссылку");
            }
          }}
        >
          Поделиться
        </button>
        <button className="text" onClick={report}>
          Пожаловаться
        </button>
        {me?.id === e.creatorId && (
          <button
            className="text red-text"
            disabled={pending}
            onClick={() => run(() => request(`/events/${e.id}`, "DELETE"))}
          >
            Отменить событие
          </button>
        )}
      </div>
      {shareMessage && <p role="status">{shareMessage}</p>}
      {e.joined && e.telegramChatUrl && (
        <a
          className="text"
          href={e.telegramChatUrl}
          target="_blank"
          rel="noreferrer"
        >
          Чат активности ↗
        </a>
      )}
      {q.error && <p role="alert">{friendly(q.error)}</p>}
    </>
  );
}
function LocationForm({
  run,
  done,
}: {
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <h2>Открыт к общению</h2>
      <p>
        Геолокация запрашивается только после нажатия кнопки. Сервер сохранит
        приблизительную область.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          if (!navigator.geolocation) {
            setBusy(false);
            return setError("Геолокация недоступна.");
          }
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              try {
                const result = await run(() =>
                  request("/users/me/location-status", "PUT", {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    statusType: f.get("type"),
                    ttlHours: Number(f.get("ttl")),
                    audience: f.get("audience"),
                    showDistance: f.has("showDistance"),
                  }),
                );
                if (result) done();
              } finally {
                setBusy(false);
              }
            },
            () => {
              setError(
                "Нет доступа к геолокации. Проверь разрешения устройства.",
              );
              setBusy(false);
            },
            { timeout: 15000, maximumAge: 60000 },
          );
        }}
      >
        <label htmlFor="type">Что хочется?</label>
        <select id="type" name="type">
          <option value="SPORT">Хочу спорт</option>
          <option value="SOCIAL">Хочу компанию</option>
          <option value="DATING">Открыт к дейтингу</option>
          <option value="OPEN">Открыт ко всему</option>
        </select>
        <label htmlFor="ttl">На сколько?</label>
        <select id="ttl" name="ttl">
          <option value="1">1 час</option>
          <option value="3">3 часа</option>
          <option value="12">12 часов</option>
        </select>
        <label htmlFor="audience">Кто видит?</label>
        <select id="audience" name="audience">
          <option value="COMMUNITY">Сообщество</option>
          <option value="MATCHES">Только мэтчи</option>
        </select>
        <label className="check">
          <input name="showDistance" type="checkbox" />
          Показывать примерное расстояние
        </label>
        {error && (
          <p role="alert" className="red-text">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Запрашиваем…" : "Поделиться приблизительной областью"}
        </button>
      </form>
      <button
        className="text red-text"
        onClick={async () => {
          const r = await run(() =>
            request("/users/me/location-status", "DELETE"),
          );
          if (r) done();
        }}
      >
        Скрыть себя сейчас
      </button>
    </>
  );
}
function ReportForm({
  target,
  done,
}: {
  target: Record<string, string>;
  done: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h2>Сообщить о проблеме</h2>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await request("/reports", "POST", {
              ...target,
              reason: f.get("reason"),
              description: f.get("description"),
            });
            done();
          } catch (e) {
            setError(friendly(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="reason">Причина</label>
        <select id="reason" name="reason">
          <option value="SPAM">Спам</option>
          <option value="HARASSMENT">Домогательства</option>
          <option value="DANGER">Опасное поведение</option>
          <option value="CONTENT">Неподходящий контент</option>
          <option value="OTHER">Другое</option>
        </select>
        <label htmlFor="reportDescription">Комментарий</label>
        <textarea id="reportDescription" name="description" maxLength={2000} />
        {error && (
          <p className="red-text" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Отправляем…" : "Отправить жалобу"}
        </button>
      </form>
    </>
  );
}
function PhotoEditor({
  me,
  done,
  run,
}: {
  me: Me;
  done: () => Promise<void>;
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <h2>Твои фотографии</h2>
      <p>
        До 6 фото. JPEG, PNG или WebP, до 8 MB. Метаданные удаляются при
        загрузке.
      </p>
      <div className="photo-grid">
        {me.photos.map((p) => (
          <div key={p.id}>
            <img src={p.url} alt="Ваше фото" />
            <button
              className="text red-text"
              disabled={busy}
              onClick={async () => {
                const result = await run(() =>
                  request(`/users/me/photos/${p.id}`, "DELETE"),
                );
                if (result) await done();
              }}
            >
              Удалить ×
            </button>
          </div>
        ))}
      </div>
      {me.photos.length < 6 && (
        <label
          className="btn"
          style={{ display: "inline-block", marginTop: 20 }}
        >
          {busy ? "Загружаем…" : "Добавить фото"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 8 * 1024 * 1024)
                return setError("Файл должен быть меньше 8 MB");
              const form = new FormData();
              form.append("file", f);
              setBusy(true);
              setError("");
              try {
                await request("/users/me/photos", "POST", form);
                await done();
              } catch (e) {
                setError(friendly(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="red-text">
          {error}
        </p>
      )}
    </>
  );
}
function Admin() {
  const { me } = useSession();
  const qc = useQueryClient();
  const [section, setSection] = useState("reports");
  const [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["admin", section],
    queryFn: () =>
      request<{ items: any[] }>(
        section === "clubs" ? "/clubs" : `/admin/${section}`,
      ),
    enabled: !!me && me.role !== "USER",
  });
  const mutate = useMutation({
    mutationFn: async ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body?: unknown;
    }) => request(path, method, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => setError(friendly(e)),
  });
  if (me?.role === "USER")
    return (
      <div className="empty">
        <h2>Доступ ограничен</h2>
        <p>Раздел доступен только команде модерации.</p>
      </div>
    );
  return (
    <>
      <div className="chips">
        {["reports", "users", "events", "clubs"].map((s) => (
          <button
            key={s}
            className={"chip " + (section === s ? "selected" : "")}
            onClick={() => setSection(s)}
          >
            {
              {
                reports: "Жалобы",
                users: "Пользователи",
                events: "События",
                clubs: "Клубы",
              }[s]
            }
          </button>
        ))}
      </div>
      <Status
        loading={q.isPending}
        error={q.error}
        empty={q.data?.items.length === 0}
        retry={() => q.refetch()}
      />
      {error && <p className="red-text">{error}</p>}
      {q.data?.items.map((row) => (
        <div key={row.id} className="report-row">
          <b>{row.title || row.firstName || row.name || row.reason}</b>
          <p className="subtle">{row.id}</p>
          {section === "reports" && (
            <>
              <p>
                {row.description} · {row.status}
              </p>
              <div className="actions">
                {["IN_REVIEW", "RESOLVED", "REJECTED"].map((s) => (
                  <button
                    className="btn alt"
                    key={s}
                    disabled={mutate.isPending}
                    onClick={() => {
                      const reason = window.prompt(
                        "Обоснование решения (минимум 3 символа)",
                      );
                      if (reason)
                        mutate.mutate({
                          path: `/admin/reports/${row.id}`,
                          method: "PATCH",
                          body: { status: s, reason },
                        });
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          {section === "users" && me?.role !== "MODERATOR" && (
            <div className="actions">
              <button
                className="btn alt"
                disabled={mutate.isPending}
                onClick={() => {
                  const reason = window.prompt("Обоснование");
                  if (reason)
                    mutate.mutate({
                      path: `/admin/users/${row.id}/block`,
                      method: "PATCH",
                      body: { blocked: !row.isBlocked, reason },
                    });
                }}
              >
                {row.isBlocked ? "Разблокировать" : "Заблокировать"}
              </button>
              <button
                className="btn alt"
                disabled={mutate.isPending}
                onClick={() => {
                  const reason = window.prompt("Основание проверки");
                  if (reason)
                    mutate.mutate({
                      path: `/admin/users/${row.id}/verify`,
                      method: "PATCH",
                      body: { verified: !row.isVerified, reason },
                    });
                }}
              >
                {row.isVerified ? "Снять verified" : "Подтвердить профиль"}
              </button>
            </div>
          )}
          {section === "events" &&
            !row.isCancelled &&
            me?.role !== "MODERATOR" && (
              <button
                className="btn alt"
                disabled={mutate.isPending}
                onClick={() =>
                  mutate.mutate({
                    path: `/admin/events/${row.id}`,
                    method: "DELETE",
                  })
                }
              >
                Отменить событие
              </button>
            )}
        </div>
      ))}
    </>
  );
}
