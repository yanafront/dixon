# REST API v1

Base: `https://<railway-domain>/api/v1`. HTTPS only in production. JSON except multipart photo upload. Use `Authorization: Bearer <opaque session token>`. Tokens expire after 12 hours, are held only in browser memory, hashed in PostgreSQL and revoked by account deletion/suspension. Reopen Mini App to re-authenticate. Auth accepts raw `initData` signed by Telegram within 5 minutes; never trust `initDataUnsafe`.

Errors: `{ "error": { "code": "EVENT_FULL", "message": "Event has reached capacity" } }`. Validation 422, unauthorized 401, forbidden 403, hidden/not found 404, conflicts 409, throttled 429. Typical lists return `{items,nextCursor}`; event list supports a next-page cursor. Bounded MVP discovery, nearby, clubs and notifications return at most 30/100 records; broad scaling needs spatial and cursor pagination.

| Method      | Path                                                          | Input / response                                                                                    |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST        | /auth/telegram                                                | `{initData}` → `{token,user}`                                                                       |
| GET         | /auth/me, /users/me                                           | own profile including preferences                                                                   |
| POST        | /auth/dev                                                     | `{telegramId:900001..900003 as string}`; development + localhost only + ALLOW_DEV_AUTH              |
| PATCH       | /users/me                                                     | shared `profileInput` schema: name, DOB, city, gender, bio, level, sports, goals, flags/preferences |
| DELETE      | /users/me                                                     | hard-delete user and dependent data, revoke sessions, queue object removal                          |
| GET         | /users/:id                                                    | safe public projection (no DOB, username, role or raw location)                                     |
| GET         | /users/nearby                                                 | active approximate locations only; block/audience/age checks                                        |
| PUT         | /users/me/location-status                                     | `{latitude,longitude,statusType,ttlHours,audience,showDistance}`                                    |
| DELETE      | /users/me/location-status                                     | remove visibility immediately                                                                       |
| POST        | /users/me/photos                                              | multipart `file`, up to 8 MB, six slots                                                             |
| DELETE      | /users/me/photos/:id                                          | ownership checked, queue object deletion                                                            |
| GET         | /discover                                                     | `mode=SPORT/FRIENDS/DATING/NETWORKING/OPEN`, optional `radius`                                      |
| POST        | /users/:id/like, /skip                                        | `{mode}`; idempotent first decision, optional real mutual match                                     |
| GET         | /matches                                                      | active, accessible matched profiles                                                                 |
| POST        | /matches/:id/contact                                          | permitted Telegram URL; otherwise 409 CONTACT_PRIVATE                                               |
| GET         | /events                                                       | `category,date,city,distance,difficulty,joined,saved,cursor`                                        |
| POST        | /events                                                       | shared `eventInput`; creator counts as first participant                                            |
| GET         | /events/:id                                                   | detail, requester membership and count; private events membership only                              |
| PATCH       | /events/:id                                                   | full eventInput replacement, creator only; cannot reduce below attendance                           |
| DELETE      | /events/:id                                                   | cancellation + notifications, creator only                                                          |
| POST        | /events/:id/join, /leave                                      | row lock, authoritative count; retries idempotent                                                   |
| POST/DELETE | /events/:id/save                                              | server persistence, idempotent                                                                      |
| GET         | /events/:id/participants                                      | visible, unblocked profiles only                                                                    |
| POST        | /events/:id/confirm                                           | participant-only, after end; deduplicated confirmation                                              |
| GET         | /users/me/saved-events                                        | saved event IDs; feed via /events?saved=true                                                        |
| GET         | /clubs, /clubs/:id                                            | curated clubs                                                                                       |
| POST        | /clubs/:id/join, /leave                                       | persisted membership; owner cannot leave                                                            |
| GET         | /clubs/:id/participants                                       | safe member profiles                                                                                |
| POST        | /blocks                                                       | `{userId}`; immediate reciprocal exclusion and match deactivation                                   |
| DELETE      | /blocks/:id                                                   | remove your block; old matches remain inactive                                                      |
| POST        | /reports                                                      | exactly one targetUserId/targetEventId/targetPhotoId, reason, description                           |
| GET         | /notifications                                                | own notifications                                                                                   |
| PATCH       | /notifications/:id/read                                       | own read receipt                                                                                    |
| POST        | /telegram/webhook                                             | Telegram secret header, idempotent update IDs, private /start and /stop                             |
| POST        | /analytics                                                    | allowlisted client event name only; server records domain actions                                   |
| GET         | /health                                                       | checks DB, returns `{status:ok}`                                                                    |
| GET         | /admin/reports, /admin/users, /admin/events, /admin/analytics | MODERATOR+                                                                                          |
| PATCH       | /admin/reports/:id                                            | MODERATOR+, status + mandatory reason, audit                                                        |
| PATCH       | /admin/users/:id/block                                        | ADMIN+, blocked + reason; staff protected                                                           |
| PATCH       | /admin/users/:id/verify                                       | ADMIN+, verified + reason, audit                                                                    |
| DELETE      | /admin/events/:id, /admin/photos/:id                          | ADMIN+                                                                                              |

Run `packages/types/src/index.ts` Zod schemas on the backend; frontend imports corresponding types. Event price is BYN whole units in current UI; no payments collected. Additional sport parameters: running distance_km/pace_min_km/surface; cycling distance_km/speed_kmh/bike_type; hiking distance_km/elevation_m/duration_min/equipment. Unknown keys rejected. Event dates are ISO timestamps, displayed Europe/Minsk.

Production /auth/dev is always unavailable, even if a flag is mistakenly configured (startup rejects ALLOW_DEV_AUTH in production). No production fake users or matches.

`GET /users/me/location-status` returns only the requester’s active status (null after TTL) for the UI visibility indicator.
