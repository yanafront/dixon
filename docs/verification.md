# Verification — 30 October 2026

## Evidence recorded so far

- Prisma schema generated and initial PostgreSQL SQL migration emitted.
- TypeScript checks for API and web passed.
- Telegram unit tests: seven passed (valid, forged, expired, future, duplicate parameters; birthday boundary; public DTO privacy contract).
- Next.js 16.4.3 production build and API compilation passed after security upgrades.
- npm audit after dependency deduplication: zero vulnerabilities (including dev dependencies).
- PostgreSQL integration test exists and CI template defines a real PostgreSQL 17 service. GitHub rejected workflow upload because the current PAT lacks workflow scope; template is supplied in docs/ci/github-actions.yml and has not run. Local execution blocked by OS sandbox: initdb `shmget` → Operation not permitted. Not marked passed.

## Not yet accepted as production

- Vercel/Railway plugins were discovered but are not connected. No service/DB has been created or billed; no production URL is verified.
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
