# Tasks

A calendar and tasks hybrid for students and builders. Your fixed week stays visible, tasks and projects sit beside it, and you drag them onto free time.

Status: pre-release (`0.x.x`). Built so far:
- v0.0, the walking skeleton: sign-in, a database, the installable PWA shell, the production image, CI and the deploy pipeline;
- v0.1, the recurrence engine;
- v0.2, the readable calendar: your timetable as a day view on a phone and a week view on a laptop, a form to add and edit classes, and offline reads.

Design docs live in `docs/brainstorm/`.

## Quick start

Needs:
- Node 24 or newer;
- pnpm (`sudo pacman -S pnpm` on Arch; the repo pins the version in `package.json`);
- Docker with the Compose plugin, and your user in the `docker` group (log out and back in after adding it). Docker runs the local Postgres.

```sh
git clone https://github.com/SigniorAtif/Tasks.git && cd Tasks
pnpm i && pnpm dev
```

Then open <http://localhost:5173>. `pnpm dev` starts Postgres (`compose.yaml`), applies the migrations, and runs the API (port 3000) and the web dev server (port 5173) side by side. The web server forwards `/api` and `/healthz` to the API, so the browser sees one origin, as in production.

Measured on 2026-10-12, from a fresh clone, with the `postgres:18` image already pulled:

| Step | Time |
|---|---|
| `pnpm i`, empty package store (first time on a machine) | 29 s |
| `pnpm i`, warm package store | 0.8 s |
| `pnpm dev` until `/healthz` reports the database is up (new, empty database) | 6.6 s |

No `.env` is needed in development: every setting has a safe default. Copy `.env.example` to `.env` to change one. The list there explains each variable.

### Signing in locally

Google sign-in needs an OAuth client (see `deploy/README.md`, step 1). Without one, the sign-in button says Google isn't set up. To look at the signed-in screens anyway, mint a session for an allowlisted email (the default allowlist is `you@example.com`) and paste the printed cookie into the browser:

```sh
pnpm --filter @tasks/api dev:session you@example.com
```

It only runs when the app's origin is `localhost`.

### Putting a timetable in

A timetable is a small JSON file: one line per class, with its day, start, end, title and room. `fixtures/sample-timetable.json` is a made-up example of the format (`packages/core/src/timetable.ts` defines it). To load it into your local database for a user who has signed in once (or has a `dev:session`):

```sh
pnpm --filter @tasks/api seed:sample you@example.com
```

`seed:private` does the same with `private/kiit-sem3.json`, a git-ignored folder for a real timetable that must never be committed. Running a seed again replaces the groups with the same names. Both refuse to run unless the database and the app are on `localhost`.

## Commands

Run from the repo root. `pnpm -r` means "in every package that has this script".

```sh
pnpm dev         # Postgres + API + web, with reload on save
pnpm build       # build the PWA into apps/web/dist
pnpm start       # the API the production way (serves STATIC_DIR if set)
pnpm db:migrate  # apply database migrations
pnpm test        # every package's tests; starts the local Postgres first if it isn't running
pnpm test:tz     # time-sensitive tests under UTC, Asia/Kolkata and America/New_York
pnpm e2e         # build the PWA, then the end-to-end test in Chromium (below)
pnpm coverage    # branch coverage, gated at 90% on the recurrence engine
pnpm typecheck
pnpm check       # Biome: lint and format (pnpm check:fix to apply fixes)
```

`pnpm e2e` runs `e2e/` with Playwright: it starts the API on port 3100, serving the fresh build, against a database of its own (`tasks_e2e`, emptied each run), and signs in with `dev:session`. It needs the local Postgres running, and Chromium once per machine: `pnpm --filter @tasks/e2e exec playwright install chromium`.

In the API package: `pnpm --filter @tasks/api seed <file.json> [email]` (and `seed:sample`, `seed:private`) loads a timetable file into the local database.

To try the installable PWA (the service worker only runs in a production build), use `pnpm build` and then `pnpm --filter @tasks/web preview`. After changing `apps/web/public/logo.svg`, regenerate the icons with `pnpm --filter @tasks/web generate-pwa-assets`.

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Pure TypeScript shared by every app: the shared types (`src/types.ts`), the HTTP contract (`src/api.ts`), the request schemas both sides validate with (`src/schemas.ts`), the timetable file format (`src/timetable.ts`), the group palette, the user's day and what counts as archived (`src/days.ts`) and the recurrence engine (`src/recurrence/`). No I/O, no clock. |
| `apps/api` | The Hono API: env validation, logging, errors, `/healthz`, Better Auth (Google + an allowlist), `/api/v1/me`, the calendar routes (`/api/v1/groups`, `/series`, `/calendar`), the seed script, and Drizzle migrations in `drizzle/`. The calendar tables use Postgres row-level security: each request runs as the signed-in user. Node runs its TypeScript directly; there is no build step. |
| `apps/web` | The React PWA: Vite, TanStack Router and Query, Tailwind, `vite-plugin-pwa`. The calendar grid is in `src/calendar/`, the class form in `src/series/`, the Groups screen and group form in `src/groups/`, and what every screen shares in `src/components/`; the query cache is kept in IndexedDB so recent weeks open offline. |
| `e2e/` | The Playwright end-to-end test: a real browser against the built app, the API and Postgres. |
| `fixtures/` | Made-up example files, such as a sample timetable. |
| `compose.yaml` | The local development database. |
| `Dockerfile`, `deploy/` | The production image, the production Compose stack (Caddy, API, Postgres), the deploy script and the runbook for the one-time server setup (`deploy/README.md`). |
| `.github/workflows/` | CI on every pull request; build, push and deploy on `main`. |
| `docs/brainstorm/` | Design documents, one per area, written before the code. Decision numbers after D-010 (such as `D-034`) refer to a planning log kept outside the repo. |

## Licence

MIT. See `LICENSE`.
