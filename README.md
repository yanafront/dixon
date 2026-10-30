# DIXON MOVEMENT

Telegram Mini App: Next.js/React frontend, NestJS modular backend, PostgreSQL + Prisma. Existing black/white/red visual design and five-section navigation are preserved. Server owns all entities; no localStorage identities, events, fake reciprocal likes or fake people in the new app.

## Repository

- `apps/web`: mobile-first React UI, TanStack Query, MapLibre, `/admin` interface.
- `apps/api`: auth, users, discovery, events, safety, media, clubs, notifications, analytics.
- `packages/types`: shared Zod request contracts and response DTOs.
- `prisma`: schema, initial SQL migration and guarded seed.
- `dist`: legacy demonstration snapshot, not the production frontend or Vercel build target. Public Sites demo stays unchanged until production cutover.
- `docs`: [migration plan](docs/migration-plan.md), [API](docs/api.md), [database](docs/database.md), [deployment](docs/deployment.md), [verification](docs/verification.md).

## Local setup

Node 22.11+, npm 10+, Docker. From repository root:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm ci
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Backend :3001/api/v1, frontend :3000. Dev script loads root .env and preserves TypeScript decorator metadata (compiled code, same as production). Prisma reads root .env. Development Telegram fallback allows only three fixed local identities, only localhost, only when NODE_ENV=development and ALLOW_DEV_AUTH=true. It is disabled in production; no production login bypass. Use real bot initData to test inside Telegram.

Optional without Docker: `node scripts/local-postgres.mjs` (port 55432), update DATABASE_URL port. On sandboxed systems shared-memory access may be unavailable; use Docker or CI. Optional local fixtures: `SEED_DEMO=true npm run db:seed`, never production.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Real PostgreSQL HTTP tests, dedicated test database only:

```bash
NODE_ENV=test DISABLE_WORKER=true BOT_TOKEN=integration-test-token \
DATABASE_URL=postgresql://dixon:local-only-change-me@localhost:5432/dixon_test \
npm run test:integration
```

Create dixon_test and apply migrations first with the same DATABASE_URL. `docs/ci/github-actions.yml` is a ready-to-enable template that provisions PostgreSQL and runs the complete flow, auth/age tests, builds and dependency audit.

## Secrets

Copy only `.env.example` templates. Never commit real secrets. Backend uses DATABASE_URL, BOT_TOKEN, FRONTEND_URL, TELEGRAM_WEBHOOK_SECRET, S3 credentials, optional Sentry/PostHog keys. Frontend uses NEXT_PUBLIC_API_URL, optional map style and browser Sentry DSN. Sessions are opaque tokens stored only in memory and hashed in DB (JWT_SECRET is not used). Real S3 photographs are sanitized WebP and EXIF stripped; public DTOs omit private data.

## Deploy

Frontend: Vercel Root Directory apps/web. Backend: Railway Dockerfile apps/api/Dockerfile, root context; Railway PostgreSQL. Railway start command npm run railway:start runs migrations and seed before API startup; never migrate dev. See docs/deployment.md for provider settings; legacy railway.json is archived. See [deployment instructions](docs/deployment.md). Existing demo URL is not proof of this production infrastructure. See [verified checks and release blockers](docs/verification.md).

To enable CI, copy `docs/ci/github-actions.yml` into `.github/workflows/ci.yml` using a GitHub credential with workflow write permission. The current source-push credential lacks this permission.
