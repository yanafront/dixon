# Verification — 30 October 2026

## Evidence recorded so far

- Prisma schema generated and initial PostgreSQL SQL migration emitted.
- TypeScript checks for API and web passed.
- Telegram unit tests: eight passed (valid, forged, expired, future, duplicate parameters; birthday boundary; public profile and event DTO privacy contracts).
- Next.js 16.4.3 production build and API compilation passed after security upgrades.
- npm audit after dependency deduplication: zero vulnerabilities (including dev dependencies).
- PostgreSQL integration test exists and CI template defines a real PostgreSQL 17 service. GitHub rejected workflow upload because the current PAT lacks workflow scope; template is supplied in docs/ci/github-actions.yml and has not run. Local execution blocked by OS sandbox: initdb `shmget` → Operation not permitted. Not marked passed.

## Not yet accepted as production

- Vercel and Railway connections are now authorized. Frontend production deployment is verified below; DIXON backend and PostgreSQL have not yet been provisioned on Railway.
- No real bot/storage/Sentry/PostHog secrets were provided. SDK/API integration code exists; actual deliveries, uploads and observability are unverified.
- iOS, Android and Desktop Telegram checks require the deployed app and real test accounts/devices.
- Operational moderation, backup/restore and privacy retention are launch gates.

## Implementation limitations to review before rollout

- MVP recommendation query bounds candidates to latest 200 users, returns top 30; nearest/spatial pagination should replace this for a larger city.
- Club creation is curated/operator-managed; UI supports join/leave/listing. No marketplace, subscriptions or internal messenger.
- No optimistic writes: controls wait for server confirmation, ensuring rollback is unnecessary.
- Photo objects are public once sanitized and uploaded; removal from DB is immediate and physical S3 deletion is asynchronous/retried.
- Sentry captures runtime exceptions with PII disabled; release source-map upload requires CI configuration.
- Telegram outbox is at-least-once. Queue requires monitoring and manual redrive after retry exhaustion.
- Structured logging is intentionally minimal/redacted. A successful local build does not certify a production deployment.

## GitHub CI activation

The current PAT permits source pushes but refuses workflow changes. Copy docs/ci/github-actions.yml to .github/workflows/ci.yml after granting workflow scope (classic PAT) or Workflows write permission (fine-grained PAT), or add it in GitHub UI. This limitation is not worked around by claiming integration tests passed.

## Browser verification

In-app browser navigation timed out. Local development watcher hit sandbox filesystem limits (FSEvents/EMFILE). No mobile visual or Telegram-device pass is claimed. Production builds are used for final HTTP smoke check to avoid dev watchers.

Production frontend HTTP smoke checks: `/` and `/admin` both return 200. The admin HTML shell is public; every data endpoint independently enforces authenticated server roles. HTTP success does not verify browser rendering or authorized admin actions.

## Vercel deployment — verified 30 October 2026

- Project: dixon-movement (`prj_l2f2MOY6evQdLNxAtetuupodKDfd`).
- Source: production-mvp, commit `c81c4a9da54fc9917d78a4f5fcd3d46518d08db6`.
- Production URL: https://dixon-movement.vercel.app
- Deployment: `dpl_32pEQqtRExB1YNPapXRAUa43LmGE`, target production, READY.
- Framework: Next.js 16.4.3; Node.js 22; build duration about 64 seconds.
- Authenticated HTTP check returned 200, expected DIXON page title and Telegram sign-in screen.
- Preview `dpl_3J4aCAACEP6YoBBr4HvLGWh9xW6B` also READY.
- Initial build failed because frontend TypeScript dependency was missing in cloud installation; fixed by explicitly declaring TypeScript/@types/node in apps/web and setting npm ci --include=dev.
- Runtime error scan for the production deployment over the last 10 minutes returned no matching error/fatal records. This is a new static frontend deployment, not proof of a working backend or completed Telegram journey.
- Deployment Protection remains enabled. HTTP verification used the owner's authorized Vercel access.
- NEXT_PUBLIC_API_URL, real Telegram bot, storage and monitoring still need production configuration. Frontend publication alone is not complete MVP acceptance.
