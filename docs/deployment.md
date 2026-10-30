# Vercel + Railway deployment

These are deployment instructions, not evidence that production is deployed. Current public Sites URL is the legacy demonstration. New app needs provider connections and secrets.

## Railway

1. Create a Railway project and PostgreSQL service. Connect the API service to the GitHub repository; Dockerfile `apps/api/Dockerfile`, repository root as build context. Service settings define Dockerfile, start command and healthcheck. New Railway services no longer accept legacy railway.json (deprecated by provider).
2. Set DATABASE_URL to Railway's private PostgreSQL reference. Set NODE_ENV=production, real BOT_TOKEN, exact FRONTEND_URL (comma-separated allowed origins), TELEGRAM_WEBHOOK_SECRET (random ≥32 characters). Disable/remove ALLOW_DEV_AUTH. Set ADMIN_TELEGRAM_IDS to real trusted operator IDs.
3. Configure S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_PUBLIC_URL. Bucket holds only sanitized public profile photos; credentials restricted to this bucket. Use a separate bucket/environment for staging. No uploads if storage is unconfigured.
4. Set SENTRY_DSN and POSTHOG_API_KEY, POSTHOG_HOST (regional host); these keys belong on API service only. Do not put them into NEXT_PUBLIC variables.
5. Railway build runs npm ci, Prisma generate, tsc. Start command npm run railway:start runs Prisma migrate deploy + guarded reference-data seed before the API. API uses process.env.PORT. Confirm /api/v1/health returns 200 and DB is reachable. Start with one API replica; PostgreSQL rate/outbox locks work with additional replicas.
6. Review CORS domain after Vercel deployment. Requests still require bearer authentication; CORS is not an authorization boundary.

## Vercel

1. Import the same repo, framework Next.js, Root Directory `apps/web`; enable including source files outside the Root Directory (shared workspace types).
2. Set NEXT_PUBLIC_API_URL=https://<railway-host>/api/v1. Optional NEXT_PUBLIC_MAP_STYLE_URL defaults to OpenFreeMap Liberty; tiles/style must be production-appropriate for expected traffic. Set NEXT_PUBLIC_SENTRY_DSN to browser project's DSN.
3. Root npm workspaces lockfile is authoritative. Build from apps/web with `npm run build`; Vercel resolves workspace dependencies from repository root. Do not use legacy dist/ as frontend output.
4. Accept Vercel's allocated production domain; dixon.vercel.app and custom domains are examples, availability not assumed. Update FRONTEND_URL in Railway to the exact final origin; production rejects wildcard and HTTP origins.

## Telegram

Use BotFather to set the Mini App/menu button to Vercel HTTPS URL. In a secret-aware provider shell set BACKEND_URL on the backend. On startup it verifies the bot with getMe, registers webhook with secret_token and sets the global Mini App menu button. scripts/setup-webhook.mjs remains an optional manual utility. Do not paste bot token in a command argument or chat. No long polling. Users must open bot /start or grant Telegram write access before bot notifications; /stop disables them.

## Checks before first real users

- CI PostgreSQL critical flows pass, actual /health is green, correct DB migrations applied.
- Two real Telegram accounts, profile persistence across devices, mutual like once, event join capacity and blocked discovery/location.
- Photo upload and delete in actual bucket; queue retry and physical object removal after account deletion.
- Webhook secret rejected when invalid; real /start and one notification delivered; reminder tested with future event.
- Sentry receives a deliberate staging exception; configure source-map upload if readable production stack traces are needed (Sentry auth token is CI-only). Verify PostHog events, no raw coordinates/contact/DOB/initData in logs.
- iOS Telegram, Android Telegram and Telegram Desktop manual checklist including keyboard, safe areas, gestures, geolocation permission denied and slow network.
- Configure encrypted DB backups, restore drill, retention policy, moderation owner/escalation and media deletion retries. No billing service is provisioned automatically without a connected provider and operator-approved plan.

## Acceptance status

Do not mark production ready based on successful local build. Record real provider URLs, deployment revisions, CI run link, device evidence and observability deliveries in docs/verification.md. Missing credentials/connections remain release blockers, not silently simulated successes.

## Current DIXON wiring
Railway project: 695511f9-a4a2-4531-9ccc-11c970cfc800. Production environment: c6a9fff6-4e60-455a-a02c-c3a4edfafb08. API service: 05003c83-e4de-4c8e-b7ad-023fb3e47fe4. PostgreSQL service: de8dcabb-ba79-4b0c-8189-5cc3c091b097.

API domain: https://dixon-api-production.up.railway.app. Frontend API base: https://dixon-api-production.up.railway.app/api/v1 (Vercel production only). DATABASE_URL uses Railway's internal Postgres reference; actual credentials are not stored in the repository. BOT_TOKEN is supplied directly by the owner in Railway. TELEGRAM_WEBHOOK_SECRET is generated and stored server-side.

Settings: Dockerfile apps/api/Dockerfile, repository root /, start npm run railway:start, healthcheck /api/v1/health, port 3001. Source follows yanafront/dixon branch production-mvp. Legacy railway.json archived under docs/legacy-railway.json for historical context; do not re-enable it.
