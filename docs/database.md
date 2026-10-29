# PostgreSQL and Prisma

Prisma 6.19 is pinned to retain the requested migrate dev/deploy contract. Models: User/Profile/Session, goals/sports, DatingPreferences, UserPhoto, LocationStatus, Swipe/Match, Event/participants/saved, clubs/members, blocks/reports/moderation audit, notifications/outbox, analytics, rate buckets and webhook update deduplication.

`prisma/migrations/202610300001_initial/migration.sql` is generated from schema and committed. Local development: `npm run db:migrate`. Production: `npm run db:deploy` only, before server start. Never `db push` or `migrate dev` on production. Take a verified snapshot before migrations; roll forward a corrective migration instead of editing applied migrations.

## Invariants

- Session hashes only, expiry checked for every request; current DB role/blocked state read per request.
- Compound primary keys prevent duplicate participation, saves, club memberships, swipes and blocks.
- Canonical sorted pair + mode unique index prevents duplicate matches. Advisory transaction lock serializes reciprocal likes and blocks across all API replicas.
- Event row lock serializes capacity checks and join/leave; creator consumes one seat.
- Location stores only coarse public grid (0.02° latitude, 0.03° longitude). Incoming raw coordinates are discarded, never inserted into DB or logs. Query excludes expired statuses even if cleanup job lags. PostGIS can later add indexes on these public points without changing privacy model.
- Profile/photos are separate private/public projections. Contacts are only returned via authenticated match-consent endpoint.
- Delete cascades user-owned data, explicitly removes pair tables and analytics; S3 deletion outbox survives user deletion. Backup erasure follows provider retention, which operator must document before launch.
- Outbox workers claim rows via SKIP LOCKED; retry exponential backoff up to eight attempts. Telegram delivery is at-least-once, not exactly-once; a network failure after send may duplicate a bot notification. Inspect stalled rows and redrive manually after fixing provider problems.
- Notifications use unique semantic dedupe keys; reminder keyed by event/start/user. Webhook update_id is deduplicated transactionally.

## Seed

`npm run db:seed` creates sports and assigns ADMIN only to existing users whose Telegram IDs are in ADMIN_TELEGRAM_IDS. Auth also maps those IDs when first creating an account. It does not fabricate production people. `SEED_DEMO=true` creates local test events and a local club; explicitly rejected under NODE_ENV=production. Production clubs must be created for a real organizer by an operator through a reviewed migration/seed extension; public club creation is outside current UI.

## Local PostgreSQL

Preferred: Docker Compose PostgreSQL 17. Optional `node scripts/local-postgres.mjs` uses embedded PostgreSQL 18 on port 55432; data in ignored work/postgres. It needs OS permission for PostgreSQL shared memory. Restricted agent sandbox can deny shmget, so the CI workflow uses a real PostgreSQL service on Ubuntu.

Integration tests require DATABASE_URL with `dixon_test` and NODE_ENV=test. They create signed test Telegram identities and clean their own records; never point them at real user data.
