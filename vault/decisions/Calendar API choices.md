# Calendar API choices

The choices behind the v0.2 server side: the routes ([[Calendar API]]), the row-level security wiring ([[Row-level security in our database]]) and the timetable file with its seed script ([[Timetable files and seeding]]). Some were fixed before the code by the contracts ([[v0.2 contracts]]); this note records why, plus the ones made while building. Plan references: B6, B7, D-020, D-034, D-042, D-043 in `docs/brainstorm/00-overview.md`.

## Expansion runs on the server (B6)

- **What:** `GET /api/v1/calendar` returns finished occurrences ("DS, Monday 12 October, 02:30–03:30 UTC, C-301"). The phone never runs the engine.
- **Why:** one place computes the calendar, so the phone and a future laptop view can't disagree, and the phone downloads no engine and no Temporal polyfill. The engine stays pure and shared in `packages/core`, so moving it onto the phone later (for offline edits) is not a rewrite.
- **Alternatives:** send series and overrides and expand on the phone (a bigger bundle, and every client must run the same engine version); expand on both (two answers that can drift).

## Lists come wrapped: `{ groups: [...] }`

- **Why:** an object can grow. v0.3 can add `"archivedCount": 2` next to the list and old copies of the app on your phone just ignore it. A bare array has nowhere to put a new field without breaking them. Fixed in the contracts.
- **Alternative:** a bare `[...]`. Shorter, and a breaking change the first time anything needs to ride along.

## A window wider than 62 days is a 422, not a 400 (B7)

- **Why:** our `400` already means "I couldn't read that" (`malformed_request`, broken JSON). `?from=2026-10-01&to=2026-12-31` is perfectly readable; its *value* is wrong, which is `422 validation_failed`, with `errors` naming `to`. No new error code: the PWA already handles `validation_failed`.
- **Why a cap at all:** a screen needs a week or two; the cap stops a bug (or a curious `curl`) from asking for ten years of classes and making the server compute thousands of occurrences.
- **Alternatives:** `400` as the plan first said (blurs two different meanings); a new `range_too_wide` code (one more thing every client must know, for no different reaction); silently clamping the window (the client would think it got what it asked for).

## Idempotent create: insert, then look

- **What:** `insert … on conflict (id) do nothing returning *`. A row back → `201`. Nothing back → look the id up under RLS: found → `200` with it, unchanged; not found → `409 conflict`.
- **Why:** it's the natural idempotency of D-042. Retrying with the same id is harmless and needs no extra table. Doing the insert first (not a lookup first) also handles two copies of the same request arriving at the same moment: Postgres makes the second insert wait for the first and then do nothing, and its lookup finds the row.
- **Alternatives:** look up first, then insert (two simultaneous retries both see nothing, one insert fails, and you'd answer `409` to your own retry); `on conflict do update` (a retry would overwrite the row with whatever the retry carried, and Postgres refuses it outright on another user's hidden row); an `Idempotency-Key` table (more machinery for the same result, deferred to v3 by D-042).

## 409 `conflict` when the id is someone else's

- **Why:** the id is taken by a row you can't see. `200` would hand back nothing sensible, `500` would call it a server bug, `422` would blame a field the client generated correctly. `409` says "clashes with what's stored", and the client's fix is clear: make a new id. Fixed in the contracts.
- **The trade-off:** a `409` tells the sender that the id exists somewhere. That's acceptable: UUIDv7 ids are made on the client, aren't guessable, and the sender must already have the id to ask; the answer never says whose it is or what's in it.

## 404, never 403, for someone else's row

- **Why:** `403` would confirm "this exists, it's just not yours". A `404` looks exactly like an id nobody has. The same goes for a path `:id` that isn't a UUID: `404` (no row can have it), not `422`, and never a Postgres cast error turning into a `500`.

## A refused CHECK is a 422 naming the field you sent

- **What:** `constraints.ts` maps each constraint of migration `0001` to a field and message. For a rule over two fields (`activeTo >= activeFrom`), it blames the one the request sent.
- **Why:** a `PATCH` sends only what changes, so zod can't compare a new `activeFrom` with the stored `activeTo`; only the database has both. Without the mapping the client would get a `500` for a plain input mistake. Blaming the field you sent means the form can put the red text under the box you just edited.
- **Alternatives:** read the row first and validate the merged result in code (a second query, and a race with a parallel edit; the CHECK has to exist anyway); return a generic `422` (the form couldn't say which box is wrong).

## PATCH edits a series in place, past occurrences too, until v0.3b

- **Why:** the plan's "this and following" edit (D-023) goes through `splitSeries` and lands in v0.3b. In v0.2 nothing hangs off past occurrences yet (no attendance, no cancels), so rewriting them changes nothing you'd miss. It's documented on `updateSeriesSchema`.
- **The cost:** move DS from 08:00 to 09:00 today and last month's DS shows 09:00 too. Acceptable for a few weeks; wrong once attendance exists, which is why the split comes before it.

## Load everything per calendar request

- **What:** all your groups and series, plus only the overrides whose original *or* new date is in the window.
- **Why:** you have tens of series; three small indexed queries cost less than working out which series *could* produce something in the window. And a filter by the series' own dates would wrongly drop a class whose occurrence was moved *into* the window. Overrides are filtered because they'll grow every week.

## Every answer is `Cache-Control: private, no-store`

- **Why:** a timetable is personal data. `private` forbids shared caches (a college proxy, a CDN), `no-store` forbids keeping a copy at all; offline copies are the PWA's own job, in IndexedDB ([[Server state and caching]]). It's set once in the middleware, after the handler, so errors and `204`s carry it too.

## `Location` on a 201

- **Why:** the HTTP convention for "created, and here it lives". Cheap, and a non-TypeScript client (the v1.5 git hook) can follow it without building the URL itself.

## Repositories take a `UserScope`, not `(tx, userId)`

- **Why:** passing the transaction and the user id separately lets a caller pass a different id than the one the transaction was opened for. One object made only by `withUser` (a type-only marker enforces that) can't be mixed up, and the plain owner `db` is a type error. Details in [[Row-level security in our database]].
- **Alternative:** the brief's suggested `UserTx` (the transaction alone, branded) plus a separate `userId` argument. Same safety against the owner `db`, but not against the mismatch.

## The timetable file format (D-020, amended)

| Choice | Why | What lost |
|---|---|---|
| Slots (`day`, `start`, `end`), never RRULE strings | How a printed timetable reads; people and LLMs get `FREQ=WEEKLY;BYDAY=MO` wrong | RRULE text (D-020 rules it out) |
| One class line → one series | One slot changes alone ("Wednesday's DS moved rooms"); a timetable lists slots | `"days": ["MO","WE","FR"]` per line: shorter, but one room change would mean splitting a series |
| `start` and `end`, not a duration | What the timetable shows; `durationMin` is computed (14:00–16:00 → 120) | `durationMin` in the file (arithmetic by hand, easy to get wrong) |
| `location`, not `room` | The same word as the series field, so nothing is renamed between file and API; a run has a place but no room | `room` (the brainstorm's word, KIIT-specific) |
| `everyWeeks`, not `interval` | Says what it means to someone writing the file | `interval` (needs the rule's unit to make sense) |
| `tzid` required, once at the top | A timetable without a zone is ambiguous; every class in one file shares it | Optional, defaulting to the profile (a file would mean different times for different people) |
| Unknown keys refused, `version: 1` | A typo can't be silently ignored; holidays (v0.3b) come as version 2 | Ignoring unknown keys (`"loaction"` would quietly drop your room) |
| The real file in git-ignored `private/` | The repo is public; D-020 first said `fixtures/kiit-sem3.json`, committed | Committing it |

## The seed

| Choice | Why | What lost |
|---|---|---|
| Replace the user's groups **with the same names** | Re-running after editing the file gives the same timetable, and leaves other groups alone | Wiping all your groups (destroys things the file doesn't mention); merging by natural key (complex, and the file has no ids) |
| One transaction, through `withUser` and the API's own create functions | All or nothing; RLS applies; it can't write anything `POST` would refuse | Raw `INSERT`s as the owner (skips both) |
| Refuse unless the database **and** the app are local | Two different ways to aim it at a server by mistake; each check catches one | Checking only `NODE_ENV` (production-like local runs exist, and the Docker image sets it) |
| Counts only, no parser or query messages | They quote the file's contents (see [[Timetable files and seeding]]) | Printing what was seeded |

## Check yourself
- The plan said "a 400 above 62 days". Give the two reasons it's a 422, and say what a client does differently for each status.
- Two copies of the same create arrive in the same millisecond. With "look first, then insert", what does each get? With "insert, then look"?
- Why is it fine that a `PATCH` in v0.2 rewrites last month's occurrences, and what feature makes it not fine?
- Your friend sends `POST /api/v1/groups` with your group's id and gets `409`. What has he learned, and why is that acceptable?
