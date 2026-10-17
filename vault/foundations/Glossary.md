# Glossary

Every technical term used in this vault and the code: one line each, plus the note that explains it properly. Ctrl+F is the way to use it. If you meet a term that isn't here, it's a gap: add it, or ask.

## A–C

| Term | In one line | Explained in |
|---|---|---|
| 201 Created | The status for a create that made a new row | [[REST resources and CRUD]] |
| 204 No Content | It worked, and there's no body: our `DELETE`s | [[REST resources and CRUD]] |
| 409 Conflict | The request clashes with what's stored; ours: the client's id is taken by a row you can't see (`conflict`) | [[REST resources and CRUD]], [[Row-level security]] |
| 422 Unprocessable Content | Valid JSON with wrong values (`validation_failed`), with an `errors` entry per field | [[Validating input with schemas]], [[Error responses]] |
| aborted transaction | After an error inside a transaction, Postgres refuses everything until `ROLLBACK` | [[Transactions]] |
| ACID | Atomic, consistent, isolated, durable: what a database transaction promises | [[Transactions]] |
| adapter boundary | A small fixed interface in front of a part you might swap; ours is `TimeGridProps`, so FullCalendar could replace the grid | [[Calendar grid]], [[Calendar grid choices]] |
| allowlist | The list of emails allowed to sign in (`AUTH_ALLOWED_EMAILS`); everyone else is refused before a user row exists | [[Auth]] |
| anchor date | The day the calendar is looking at; Previous / Next move it a day or a week | [[Calendar grid]] |
| `any` | "Stop checking this value"; switches TypeScript off for it, so our code avoids it | [[TypeScript essentials]] |
| API | The program on the server that answers the app's requests (`apps/api`) | [[API server]] |
| `app.user_id` | The custom setting that tells RLS who is asking, set per transaction with `set_config` | [[Row-level security]], [[Row-level security in our database]] |
| `aria-describedby` / `aria-invalid` | Link an input to its hint and error text, and mark it as wrong, so a screen reader reads them when the input is focused | [[Series form]] |
| arm64 / amd64 | The two CPU families: phones and Oracle Ampere vs most laptops and VPSs | [[Containers and images]] |
| `as` (type assertion) | Tells the checker "trust me, this is a T"; checks nothing at run time | [[TypeScript essentials]] |
| `as const` | "This value never changes; remember its exact contents", e.g. the ten colour names | [[TypeScript essentials]] |
| `asUser` (`c.var.asUser`) | `withUser` already bound to the signed-in user; the calendar handlers get it from the `userScope` middleware and never handle a user id | [[Calendar API]], [[Row-level security in our database]] |
| autocommit | Without `BEGIN`, each statement is its own transaction | [[Transactions]] |
| background layer | Where cancelled classes are drawn: full width, behind, never taking a column (D-077) | [[Calendar grid]], [[Calendar grid choices]] |
| backoff | Waiting longer before each retry (1 s, 2 s, 4 s …) so a struggling server isn't hammered | [[Idempotency and retries]] |
| Better Auth | The library that handles Google sign-in, sessions and cookies inside our API | [[Auth]], [[API stack choices]] |
| Biome | Linter + formatter: finds mistakes and tidies code without running it (`pnpm check`) | [[Tooling choices]] |
| branch protection | A GitHub rule that blocks merging into `main` unless chosen CI jobs pass | [[CI and CD]] |
| branded type | A type with a marker property only one module can name, so only that module can make values of it; ours is `UserScope` | [[Row-level security in our database]] |
| branding (types) | A type only one function can create, like `UserScope` from `withUser` | [[TypeScript essentials]], [[Row-level security in our database]] |
| breakpoint | A screen width where the layout changes; ours is 768 px (Day view below, Week view from it) | [[Responsive layouts]] |
| build context | The files `docker build` may read; `.dockerignore` decides it | [[Containers and images]] |
| buster (cache) | A version string saved with the cached copy; a copy with a different one is thrown away instead of restored | [[Offline reads]], [[IndexedDB and offline storage]] |
| BYPASSRLS | A role attribute that skips row-level security, meant for jobs that must see every user's rows | [[Row-level security]] |
| cache (HTTP / client) | A stored copy of an answer so it needn't be fetched again | [[Server state and caching]], [[HTTP basics]] |
| Cache API | Browser storage for request → response pairs; our service worker keeps the app's files there | [[IndexedDB and offline storage]], [[PWAs and service workers]] |
| `Cache-Control: private, no-store` | "No shared cache may keep this, and nobody should store it": on every answer that carries your timetable | [[Calendar API]], [[Calendar API choices]] |
| Caddy | The front-door program on the server: HTTPS certificates, forwarding to the API | [[Reverse proxies and TLS]] |
| `calc()` | CSS arithmetic with units: `calc(var(--start) * 1.2 * 1px)` | [[CSS variables]] |
| calendar window | The days `GET /api/v1/calendar` is asked for, `from` to `to`, both included, at most 62 | [[Calendar API]] |
| captive portal | Wi-Fi that needs a login page first (KIIT's): the phone says "online" but requests fail until you log in | [[IndexedDB and offline storage]], [[Offline reads]] |
| cgroups | Linux feature that limits a container's CPU and memory | [[Containers and images]] |
| CI / CD | Automatic checks on every PR / automatic deploy after merging | [[CI and CD]], [[Deploy and CI]] |
| class line (slot) | One `day` + `start` + `end` in a timetable file; it becomes one weekly series | [[Timetable files and seeding]] |
| Cloudflare | Sits in front of the server: DNS, edge HTTPS, blocks abuse, hides the server's IP | [[How a request travels]] |
| cluster (layout) | Calendar blocks joined by overlaps, directly or through a chain; each is laid out on its own | [[Interval partitioning]] |
| collection / item | A list resource (`/api/v1/series`) and one member of it (`/api/v1/series/:id`) | [[REST resources and CRUD]] |
| `color-mix()` | CSS that blends two colours: `color-mix(in oklab, teal 20%, white)` is a light teal tint | [[CSS variables]] |
| colour token | A group's colour stored as a name (`teal`), turned into a light or dark colour by CSS; one of ten | [[Calendar grid choices]], [[CSS variables]] |
| commit SHA | The ID of one exact version of the code (`19b11d7…`); `/healthz` reports it | [[v0.0 in plain words]] |
| composite foreign key | A foreign key on two columns, `(user_id, group_id)`, so a row can only point at a parent of the same user | [[Row-level security]] |
| connection pool | A few open database connections that requests borrow and return | [[Connection pools]] |
| constraint | A rule Postgres enforces on every write (unique, foreign key, check) | [[Postgres and SQL basics]] |
| container | One running copy of an image, a fenced-off process | [[Containers and images]] |
| contract | The agreed shapes of requests and responses, in `packages/core/src/api.ts` | [[v0.0 contracts]] |
| contrast ratio | How different two colours' brightness is, 1:1 to 21:1; text needs 4.5:1, meaningful shapes 3:1 | [[CSS variables]] |
| controlled input | An input whose value always comes from React state, updated on every keystroke (`value` + `onChange`) | [[Series form]], [[Offline and form choices]] |
| cookie | A small value the browser stores and sends back with every request to that site | [[Cookies and sessions]] |
| CORS | The browser rule for when a page may call *another* origin; we avoid it with one origin | [[Origin]] |
| coverage | The share of code paths tests actually run; gated at 90% on the recurrence engine | [[Testing pure code]] |
| CRUD | Create, read, update, delete: the four jobs, mapped to `POST`, `GET`, `PATCH`, `DELETE` | [[REST resources and CRUD]] |
| CSRF | A trick where another site makes your browser send a request to ours with your cookie | [[Middleware]], [[Cookies and sessions]] |
| CSS pixel | The unit CSS widths use; a typical phone is about 412 CSS px wide whatever its real pixel count | [[Responsive layouts]] |
| CSS variable (custom property) | A named CSS value, `--start: 600`, set on an element and read below it with `var()` | [[CSS variables]] |
| `current_user` / `session_user` | Whose permissions are checked now / who logged in; `SET ROLE` changes only the first | [[Roles and privileges]] |

## D–H

| Term | In one line | Explained in |
|---|---|---|
| daemon (`dockerd`) | A background service; Docker's does the real work, the `docker` command just asks it | [[Containers and images]] |
| default deny | With RLS on, a row is hidden unless a policy lets it through; no policy, or no user set, means no rows | [[Row-level security]] |
| defence in depth | Two independent guards on the same risk, so one bug isn't enough (app filters plus RLS) | [[Row-level security]] |
| dehydrate / hydrate | Turn TanStack Query's cache into plain data to save it / put saved data back into the cache | [[Offline reads]] |
| deploy | Putting a new version on the server; ours is `deploy/deploy.sh` | [[Deploy and CI]] |
| depth (overlap) | The most calendar blocks happening at one moment; the fewest columns any layout can use | [[Interval partitioning]] |
| digest | A fingerprint of an image's exact content (`@sha256:…`), unlike a movable tag | [[Containers and images]] |
| discriminated union | "One of several shapes", told apart by one field (`freq`, `kind`) | [[TypeScript essentials]], [[Core types]] |
| display zone | The zone the calendar draws in: your `profile.tzid`, never the phone's own setting | [[Calendar grid]] |
| DNS | Turns a name (`tasks.ahmedatif.in`) into an IP address | [[How a request travels]] |
| Docker Compose | Describes several containers in one YAML file and runs them together | [[Docker Compose]] |
| Dockerfile | The recipe an image is built from | [[Containers and images]] |
| Drizzle | Our query builder: SQL queries written in TypeScript, checked against the schema | [[Postgres and SQL basics]], [[Database and migrations]] |
| ENABLE / FORCE ROW LEVEL SECURITY | `ENABLE` turns RLS on for a table; `FORCE` makes it apply to the table's owner too | [[Row-level security]] |
| `ensureQueryData` | Return a query's cached answer, or fetch it if there is none; used in a route's `beforeLoad` and loader | [[Offline reads]], [[Web app]] |
| `enum` | A TypeScript feature we can't use: it needs generated code, and our settings allow only types Node can delete | [[TypeScript essentials]] |
| environment variable | A named setting handed to a program at start (`PORT=3000`) | [[Environment variables and config]] |
| erasableSyntaxOnly | Our setting that allows only TypeScript that can be deleted to get JavaScript, because Node runs `.ts` by stripping types | [[TypeScript essentials]], [[TypeScript checking vs running]] |
| eviction | The browser deleting a site's stored data to free space, without asking | [[IndexedDB and offline storage]] |
| expand / contract | Migration style: add new things first, remove old ones later, so rollbacks stay safe | [[Database migrations]] |
| expansion (layout) | After columns are assigned, a block stretches right over columns that are free for its whole time | [[Interval partitioning]] |
| fast-forward / `--no-ff` | Merge styles; `--no-ff` always records a merge commit, keeping the branch visible | [[Local workflow]] |
| fixture | Fixed, made-up data that tests run against; ours is a sample semester, as TypeScript for the engine and as `fixtures/sample-timetable.json` | [[Timetable files and seeding]] |
| foreign key | "This column must match an id in that table" | [[Postgres and SQL basics]] |
| `forgetCachedData` | Our sign-out helper: clears the cache in memory and deletes the saved copy in IndexedDB | [[Offline reads]] |
| `gcTime` | How long TanStack Query keeps a query in memory once no screen shows it; ours is `Infinity` | [[Offline reads]], [[Offline and form choices]] |
| generic (`<T>`) | A type with a blank the caller fills in: `apiGet<Me>`, `Promise<Profile>` | [[TypeScript essentials]] |
| GHCR | GitHub's storage for images: CI pushes, the server pulls | [[Containers and images]] |
| gitleaks | Scans the whole git history for leaked secrets | [[Secret scanning]] |
| `GRANT` / `REVOKE` | Give / take away a privilege, e.g. `grant select on series to tasks_app` | [[Roles and privileges]] |
| greedy algorithm | One that takes the best-looking choice at each step and never goes back; for interval partitioning it's exactly optimal | [[Interval partitioning]] |
| handler | The function that answers one route (`GET /api/v1/me` → `me.ts`) | [[API server]] |
| hash | A one-way fingerprint of data (SHA-256) | [[Hashing and signing]] |
| header | A `Name: value` line in a request or response (`Cookie`, `Content-Type`) | [[HTTP basics]] |
| health check | A command that asks "are you OK?" (`/healthz`, `pg_isready`) | [[Docker Compose]], [[API server]] |
| HMAC | A signature made by hashing a message with a secret key | [[Hashing and signing]] |
| Hono | The web framework our API is written with: routes and middleware | [[API server]], [[API stack choices]] |
| HTTP / HTTPS | The request/response language of the web; HTTPS is HTTP inside TLS encryption | [[HTTP basics]], [[Reverse proxies and TLS]] |
| HttpOnly | Cookie flag: JavaScript can't read it, only the browser sends it | [[Cookies and sessions]] |

## I–O

| Term | In one line | Explained in |
|---|---|---|
| idb-keyval | A tiny wrapper that makes IndexedDB a promise-based `get` / `set` / `del` store | [[IndexedDB and offline storage]], [[Offline reads]] |
| Idempotency-Key | A header carrying a random key so the server can replay its stored answer to a retry; we don't need one yet (D-042) | [[Idempotency and retries]] |
| idempotent | Doing it twice has the same effect as once; our creates are, thanks to client-made ids | [[Idempotency and retries]], [[HTTP basics]] |
| image | A frozen bundle of an OS userland, Node, our code and deps; built once, runs anywhere | [[Containers and images]] |
| `import type` | An import used only for types, deleted before running (`verbatimModuleSyntax`) | [[TypeScript essentials]] |
| index (database) | A sorted side structure that makes lookups by a column fast | [[Postgres and SQL basics]] |
| IndexedDB | The browser's built-in asynchronous database, one per origin; our cached API data lives there | [[IndexedDB and offline storage]], [[Offline reads]] |
| inference (types) | TypeScript working out a type from the value, so you needn't write it | [[TypeScript essentials]] |
| instant | One moment in time, stored in UTC | [[Dates, times and instants]] |
| integration test | A test that runs our code against real parts (a real Postgres) | [[Integration tests]] |
| interface | A description of an object's fields and their types | [[TypeScript essentials]] |
| interval / overlap | A start and an end, `[start, end)`; two overlap when each starts before the other ends (touching isn't overlap) | [[Interval partitioning]] |
| interval partitioning | Putting overlapping intervals into as few columns as possible: sort by start, take the first free column | [[Interval partitioning]], [[Calendar grid]] |
| invalidate (a query) | Mark a cached answer out of date: refetched now if on screen, otherwise when next shown | [[Series form]], [[Server state and caching]] |
| IP address | A machine's number on a network; `127.0.0.1` is "this machine" | [[HTTP basics]] |
| isolation level | How much concurrent transactions see of each other; Postgres's default is READ COMMITTED | [[Transactions]] |
| JSON | The text format API bodies use: `{"sha":"dev"}` | [[HTTP basics]] |
| JWT | A signed, readable token holding user data; we deliberately don't use them for sessions | [[Cookies and sessions]], [[Hashing and signing]] |
| `keepPreviousData` | TanStack Query option: keep showing the last answer while the next query loads, so nothing flashes | [[Calendar grid]] |
| `key` (React) | A component's identity; changing it makes React throw the old one away and mount a fresh one | [[Calendar grid]] |
| last good answer | What we save for a query whose latest refetch failed: its previous answer, as a success | [[Offline reads]] |
| layer (image) | A cached snapshot of the files one Dockerfile step changed | [[Containers and images]] |
| least privilege | Give each part only the permissions its job needs, so a bug can do only that much damage | [[Roles and privileges]] |
| linter / formatter | Finds suspicious code / rewrites layout consistently | [[Tooling choices]] |
| literal type | A type that is one exact value, like `'not_held'` | [[TypeScript essentials]] |
| live region (`role="status"`, `role="alert"`) | An element whose text a screen reader announces when it changes; `status` waits politely, `alert` interrupts | [[Offline reads]], [[Series form]] |
| localhost guard | The seed refuses to run unless `DATABASE_URL` and `BETTER_AUTH_URL` both point at this machine | [[Timetable files and seeding]] |
| localStorage / sessionStorage | Small, synchronous text-only browser storage, per origin / per tab | [[IndexedDB and offline storage]] |
| `Location` header | Sent with a `201`: the URL where the new row now lives (`/api/v1/series/<id>`) | [[Calendar API]] |
| `LOGIN` / `NOLOGIN` | Whether a role may open a connection; `tasks_app` is `NOLOGIN` and is only switched into | [[Roles and privileges]] |
| manifest (web app) | The JSON telling the phone the app's name, icons and colours, so it can be installed | [[PWAs and service workers]] |
| `matchMedia` | Asks a media query from JavaScript, with a `change` event when the answer flips | [[Responsive layouts]] |
| `maxAge` (persister) | How old a saved cache may be before it's thrown away at start-up; ours is 30 days | [[Offline reads]], [[IndexedDB and offline storage]] |
| media query | A CSS condition about the device, e.g. `@media (min-width: 768px)` | [[Responsive layouts]] |
| middleware | Functions every request passes through before and after its handler | [[Middleware]] |
| migration | A numbered SQL file that changes the database's tables, applied once in order | [[Database migrations]] |
| mobile-first | Phone styles are the default; wider screens add rules with `min-width` | [[Responsive layouts]] |
| monorepo | One repo holding several packages (`apps/*`, `packages/*`) | [[Monorepo and workspaces]] |
| multi-stage build | A Dockerfile with throwaway stages; only the final one becomes the image | [[Containers and images]] |
| mutation | TanStack Query's name for a request that changes something on the server (POST, PATCH, DELETE) | [[Series form]] |
| namespace (Linux) | Kernel feature that gives a container its own view of processes, files and network | [[Containers and images]] |
| narrowing | TypeScript following your `if`: after `rule.freq === 'daily'`, it knows which shape `rule` is | [[TypeScript essentials]] |
| `navigator.onLine` | The browser's "connected to a network" flag; `false` is reliable, `true` doesn't mean the internet works | [[IndexedDB and offline storage]] |
| `networkMode` | What a query does while the browser says offline: `online` waits, `always` tries anyway, `offlineFirst` tries once | [[Offline reads]], [[Offline and form choices]] |
| noUncheckedIndexedAccess | Our setting: `rows[0]` may be `undefined`, so you must check it | [[TypeScript essentials]] |
| now line | The red line across today's column at the current time, moved once a minute | [[Calendar grid]] |
| `nullif(x, '')` | Turns empty text into `NULL`; guards RLS policies against the empty-setting trap | [[Row-level security]] |
| OAuth | The standard behind "Sign in with Google": Google vouches for you, and the app never sees your Google password | [[OAuth sign-in]] |
| object store | IndexedDB's version of a table: keys mapped to structured values | [[IndexedDB and offline storage]] |
| oklch / oklab | Colour spaces where equal number steps look equal to the eye; we mix in oklab so hues don't drift | [[CSS variables]] |
| `Omit` / `Partial` / `Pick` / `Record` | Helpers that build one type from another (fewer fields, optional fields, exact keys) | [[TypeScript essentials]] |
| `on conflict (id) do nothing` | An insert that silently skips an id that already exists; with a lookup after it, our creates answer 201, 200 or 409 | [[Calendar API]], [[Idempotency and retries]] |
| `onlineManager` | TanStack Query's idea of whether the device is online, from the browser's `online` / `offline` events; starts as online | [[Offline reads]] |
| optional field (`?`) | A field that may be missing entirely; we use `\| null` instead for stored data | [[TypeScript essentials]], [[Core types]] |
| origin | Scheme + host + port (`https://tasks.ahmedatif.in`); browsers' unit of trust | [[Origin]] |
| ORM | A library that hides SQL behind objects (Prisma); Drizzle is closer to SQL | [[Postgres and SQL basics]] |
| owner (table) | The role that created a table; may alter or drop it, and skips RLS unless `FORCE` is set | [[Roles and privileges]], [[Row-level security]] |

## P–Z

| Term | In one line | Explained in |
|---|---|---|
| parameter (`$1`) | A value sent separately from the SQL text, which makes SQL injection impossible | [[Postgres and SQL basics]] |
| parse, don't validate | Turn unknown input into a typed value or a list of errors, instead of a yes/no check | [[Validating input with schemas]] |
| `PATCH` vs `PUT` | Change the fields I send / replace the whole thing; our edits use `PATCH` | [[REST resources and CRUD]] |
| persistent storage | `navigator.storage.persist()`: asks the browser not to evict this site's data | [[IndexedDB and offline storage]] |
| persister | Saves TanStack Query's cache to storage (ours: IndexedDB) and restores it when the app starts | [[IndexedDB and offline storage]], [[Offline reads]] |
| pino | Our logger: one JSON line per event | [[Structured logging]] |
| PKCE | An extra OAuth check that stops a stolen sign-in code from being used by someone else | [[OAuth sign-in]] |
| pnpm / workspace | Package manager; a workspace links our packages to each other | [[Monorepo and workspaces]] |
| policy (RLS) | A per-table condition deciding which rows a request may see (`USING`) and write (`WITH CHECK`) | [[Row-level security]] |
| popover (HTML) | A built-in panel (`popover` attribute) the browser opens, closes on Escape or outside taps, and draws on top; our account menu | [[Calendar grid]] |
| port | A numbered door on one machine (3000 API, 5173 Vite, 5432 Postgres, 443 HTTPS) | [[HTTP basics]] |
| Postgres | Our database server | [[Postgres and SQL basics]] |
| prefetch | Fetching data before it's asked for; the calendar fetches the weeks either side of the one you see | [[Calendar grid]], [[Server state and caching]] |
| primary key | The column that uniquely identifies a row | [[Postgres and SQL basics]] |
| `private/` | The git-ignored folder in the main repo for real personal data, like your real timetable | [[Timetable files and seeding]] |
| privilege | One permission on one object: `SELECT` on a table, `USAGE` on a schema | [[Roles and privileges]] |
| problem+json | Our one error-body shape (RFC 9457) with a stable `code` | [[Error responses]] |
| proxy (dev server) | Vite forwarding `/api` to the API so the browser sees one origin | [[Dev server proxy]] |
| psql | Postgres's command-line client: `docker compose exec db psql -U tasks tasks` | [[Postgres and SQL basics]] |
| PWA | A website your phone can install like an app | [[PWAs and service workers]] |
| quota (storage) | The most a site may store in the browser; Chrome allows about 60% of the disk | [[IndexedDB and offline storage]] |
| registry | Where images are stored and downloaded from (GHCR, Docker Hub) | [[Containers and images]] |
| request id | A unique id per request, in the `X-Request-Id` header, the log line and error bodies | [[Structured logging]], [[Error responses]] |
| resource | A thing an API lets you work with, named by a URL | [[REST resources and CRUD]] |
| responsive layout | A layout that changes shape with the screen's width | [[Responsive layouts]] |
| REST | The common API style: resources named by URLs, the standard methods, status codes, no memory between requests | [[REST resources and CRUD]] |
| restore (cache) | Read the saved cache from IndexedDB and hydrate it into memory; ours runs before the first draw | [[Offline reads]] |
| reverse proxy | A server that receives requests on behalf of another (Caddy, Cloudflare) | [[Reverse proxies and TLS]] |
| RLS | Row-level security: Postgres itself hides other users' rows, through a policy on each table | [[Row-level security]], [[Row-level security in our database]] |
| role | Postgres's single kind of account; "users" are roles that can log in, "groups" are roles others join | [[Roles and privileges]] |
| rollback | Going back to the previous version after a failed deploy | [[Deploy and CI]] |
| route / routing | Matching a URL path to code: Hono on the server, TanStack Router in the app | [[API server]], [[Single-page apps and routing]] |
| `safeParse` | zod's "check and tell me": returns `{ success, data }` or `{ success, error }`, never throws | [[Validating input with schemas]] |
| salt | Random data mixed into a password hash so equal passwords hash differently | [[Hashing and signing]] |
| `satisfies` | Checks a value against a type without losing the value's exact type | [[TypeScript essentials]] |
| schema (database) | The tables and columns, defined in `apps/api/src/db/schema.ts`. Not the same as a validation schema | [[Database and migrations]] |
| schema (validation) | A description of the shape and rules data must follow, which checks it and gives its type | [[Validating input with schemas]] |
| secret | Any value that grants access (`BETTER_AUTH_SECRET`, OAuth secret); never in git | [[Environment variables and config]], [[Secret scanning]] |
| seed, seeding | Filling a database with starting data by running a script instead of typing it into the app | [[Timetable files and seeding]] |
| `seed:sample` / `seed:private` | Write the made-up sample / your real git-ignored timetable into your local database, for one user | [[Timetable files and seeding]] |
| segment | The part of one occurrence on one day column; a class crossing midnight has two | [[Calendar grid]] |
| serial id | An id the database counts up (41, 42, 43); can't be made offline, and guessable | [[Idempotency and retries]] |
| service worker | A script the browser runs beside the app; ours caches the app's files for offline opening | [[PWAs and service workers]] |
| `services:` (CI) | GitHub Actions starting a throwaway container (our Postgres) next to a test job | [[CI and CD]] |
| session | A row in `auth_session` saying "this cookie belongs to this user until …" | [[Cookies and sessions]] |
| `SET` / `SET LOCAL` / `set_config` | Change a setting for the connection / until the transaction ends / the same, as a function that takes `$1` | [[Transactions]] |
| `SET ROLE` / `SET LOCAL ROLE` | Act as another role from now / until the transaction ends | [[Roles and privileges]] |
| SPA | A single-page app: one HTML page, JavaScript swaps the screens | [[Single-page apps and routing]] |
| SQL / SQL injection | The language for asking Postgres / an attack that sneaks SQL in through a value | [[Postgres and SQL basics]] |
| SQLSTATE | Postgres' five-character error code, stable unlike the message: `23505` unique, `23503` foreign key, `23514` check, `42501` not allowed | [[Calendar API]] |
| SSH | Encrypted remote login; the deploy job uses it to run `deploy.sh` on the server | [[Deploy and CI]] |
| `staleTime` | How long TanStack Query treats an answer as fresh and won't refetch it; the calendar uses a minute | [[Calendar grid]], [[Server state and caching]] |
| status code | The 3-digit result of a request (200, 401, 404, 500) | [[HTTP basics]] |
| strict mode | Our TypeScript setting that, among other things, forbids `null` where a value is expected | [[TypeScript essentials]] |
| structured clone | The browser's built-in deep copy, used to store values in IndexedDB | [[IndexedDB and offline storage]] |
| superuser | A Postgres role that skips every permission check and RLS; our `tasks` login is one | [[Roles and privileges]] |
| sync badge | The "offline · last synced 2:02 PM" pill: the screen shows saved answers, last confirmed at that time | [[Offline reads]] |
| TanStack Query | The app's cache of server data; refetches and stores answers | [[Server state and caching]] |
| `tasks_app` | The non-owner, non-superuser role each API request switches into, so RLS applies | [[Row-level security in our database]], [[Roles and privileges]] |
| TCP | The reliable connection under HTTP: bytes arrive complete and in order | [[HTTP basics]] |
| template literal type | A type that is a text pattern: `` `--palette-${ColorToken}` `` | [[TypeScript essentials]] |
| `TimeGridProps` | The seven props the calendar grid takes: days, zone, occurrences, groups, now, zoom, on-tap | [[Calendar grid]] |
| timer overflow (24.8 days) | Browsers store a `setTimeout` delay in 32 bits; a longer delay fires immediately | [[Offline reads]], [[Offline and form choices]] |
| timetable file | The hand-writable JSON (`"format": "tasks.timetable"`, `"version": 1`) of groups and their class slots | [[Timetable files and seeding]] |
| `timetableToRows` | Pure function: a checked timetable file → the rows `POST /api/v1/groups` and `/series` take | [[Timetable files and seeding]] |
| TLS | The encryption under HTTPS, with certificates proving the server's identity | [[Reverse proxies and TLS]] |
| transaction | Statements that all happen or none do (`BEGIN` … `COMMIT` / `ROLLBACK`) | [[Transactions]], [[Postgres and SQL basics]] |
| type alias | A second name for a type: `ISODate = string`; documents, doesn't enforce | [[TypeScript essentials]], [[Core types]] |
| type checker (`tsc`) | The program that reads the types and reports mistakes before anything runs (`pnpm typecheck`) | [[TypeScript essentials]], [[TypeScript checking vs running]] |
| type stripping | Node deleting TypeScript's annotations so it can run `.ts` files directly | [[TypeScript checking vs running]] |
| union type (`\|`) | "One of these": `'not_held' \| 'skipped'` | [[TypeScript essentials]] |
| `unknown` | "Could be anything; prove what it is first"; for data from outside | [[TypeScript essentials]] |
| `UserScope` | The scoped transaction plus whose it is; only `withUser` makes one, and every calendar repository function takes it | [[Row-level security in our database]] |
| `USING` / `WITH CHECK` | The two halves of a policy: which existing rows you can see and touch / which new rows you may write | [[Row-level security]] |
| UUID / UUIDv4 | A 128-bit id written as 32 hex digits; v4 is fully random, so not in time order | [[Idempotency and retries]] |
| UUIDv7 | Our id format: made by the client, unique without asking the server, sortable by creation time | [[Idempotency and retries]], [[Database and migrations]] |
| `visibilitychange` | The browser event when a tab or app goes to the back or comes to the front; the now line re-syncs on it | [[Calendar grid]] |
| Vite | The web app's dev server and bundler | [[Web app]], [[Web stack choices]] |
| volume | A Docker-managed folder that outlives containers; Postgres's data lives in one | [[Containers and images]], [[Docker Compose]] |
| `withUser` | Runs a function in one transaction as `tasks_app` with `app.user_id` set, so RLS limits every query to that user | [[Row-level security in our database]] |
| `z.input` / `z.output` | A schema's two types: what a client may send / what the code gets after defaults and transforms | [[Validating input with schemas]] |
| zod | Our schema library: parses settings at start-up and every request body and query string | [[Validating input with schemas]], [[Environment variables and config]] |
| zod pipe | `a.pipe(b)`: check with `a`, and run `b` only if `a` passed; how the calendar route keeps bad dates away from the 62-day check | [[Calendar API]] |

## Check yourself
- Pick five terms you couldn't define without looking. Read their notes, then write each one's line again from memory.
- Which three terms in this list would you need to explain what happens when you run `pnpm dev`?
