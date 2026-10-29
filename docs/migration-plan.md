# Demo → production migration

## Baseline and reuse

The existing app is buildless HTML/JS with browser-only entities. Reuse `dist/style.css` as the visual token/layout baseline, original copy, five navigation items, event/person cards, sheets, and mobile breakpoints. Keep the original snapshot in Git history (8472b8f). No import of localStorage users or demo matches into production.

## Replace

Replace imperative HTML rendering with React components because inline handlers/global state cannot safely grow into an authenticated multi-user app. Replace all entity state with TanStack Query + API; no fake identities or automatic reciprocal likes. Replace diagram map with MapLibre. Move eligibility, age, matching, block exclusion, capacity and moderation into NestJS services. Prisma owns schema and migrations; PostgreSQL owns concurrency and uniqueness. Auth sessions are server-revocable opaque tokens hashed in DB; stored only in memory on frontend, refreshed using validated Telegram initData on reload. No client-trusted identity.

## Target structure

`apps/web`: Next.js/React/TypeScript, reused stylesheet, query client, API client, map, admin route.
`apps/api`: NestJS modular monolith, auth, profiles, events, discovery, safety, clubs, notifications, media, analytics.
`packages/types`: response DTOs and shared Zod contracts (runtime validation on server).
`prisma`: PostgreSQL schema, SQL migrations, guarded seed.
`docs`: API, database, deployment and acceptance evidence.

## Order and gates

1. Workspaces/config/schema + migrations; install and build both apps.
2. Telegram signature/freshness and revocable sessions; test malformed/expired initData.
3. Profiles/18+/goals/preferences, events and transaction-safe participation.
4. Discovery mutual preferences, race-safe unique match, bidirectional blocks.
5. Coarse location TTL and real map; clubs; reports/admin.
6. DB notifications + Telegram outbox/webhook; S3 photos; server analytics/Sentry.
7. PostgreSQL integration tests, Next build, API tests; deploy Vercel + Railway only with authenticated providers and supplied secrets. Never substitute a successful Sites demo deploy for requested infrastructure.

## Deployment dependencies

Railway and Vercel connections are requested via plugins. User must configure BOT_TOKEN, webhook secret, S3 and monitoring keys directly in provider secret settings. Do not paste secrets into chat or source files. Production deployment and mobile Telegram checks remain unverified until real providers, bot and devices are available. Existing hosted demo stays unchanged during migration.
