# Local workflow

> **Background:** [[Containers and images]] · [[Docker Compose]] · [[Postgres and SQL basics]] · [[Integration tests]] · [[CI and CD]]

How to work on the app day to day on your laptop, and how to check a change the way CI will **before** you push. Every command runs from the repo root. Background: [[Containers and images]], [[Docker Compose]], [[CI and CD]], [[Integration tests]].

## One-time setup

1. Log out and back in once, so your user's new `docker` group membership applies. Until then, plain `docker` says *permission denied while trying to connect to the docker API*. (Done on this laptop as of 2026-10-13.)
2. `sudo pacman -S docker-buildx`. Building the production image needs the buildx plugin. (Done on this laptop: buildx 0.37.)
3. `pnpm i`.

## Daily: run the app

```sh
pnpm dev
```

What happens, in order:
1. `docker compose up -d --wait db` starts **one container**, Postgres 18, from `compose.yaml`. `-d` means "in the background"; `--wait` means "until its health check says it's ready". Its data lives in the volume `tasks-dev_db-data`, so it survives restarts.
2. The API's `dev` script applies any new migrations, then starts the API on port 3000 with `node --watch`: it restarts when you save a file.
3. Vite starts the web app on port 5173 and reloads the browser when you save.

Steps 1 and 2 are two `dev` scripts, one calling the other:

```json
// package.json: what `pnpm dev` runs
    "dev": "docker compose up -d --wait db && pnpm -r --parallel run dev",
// apps/api/package.json: the API's own `dev`
    "dev": "node --env-file-if-exists=../../.env src/db/migrate.ts && node --env-file-if-exists=../../.env --watch src/main.ts",
```

- `pnpm -r --parallel run dev` runs the `dev` script of every package at the same time; that's how the API and Vite both start from one command.
- `&&` means "then, if that worked". If Postgres doesn't come up, nothing else starts; if a migration fails, the API doesn't start at all.
- `--env-file-if-exists=../../.env` makes Node read the repo's `.env` (if there is one) into `process.env` before the code runs.

Step 1's container, and where the volume name comes from:

*From `compose.yaml` (shortened):*
```yaml
name: tasks-dev

services:
  db:
    # Pinned to the exact minor version; bump it on purpose, not by accident.
    image: postgres:18.6
    # …
    ports:
      # 127.0.0.1 only: reachable from this machine, not from the rest of the network.
      - "127.0.0.1:5432:5432"
    volumes:
      # …
      - db-data:/var/lib/postgresql
    # …
volumes:
  db-data:
```

Compose prefixes everything with the project `name`, so the volume `db-data` becomes `tasks-dev_db-data`. A fixed name means every checkout of the repo (and every git worktree) shares this one database. `127.0.0.1:5432:5432` publishes the port to your laptop only, so someone on the same campus Wi-Fi can't connect to it.

Open <http://localhost:5173>. To see the signed-in screens without Google, mint a session cookie: `pnpm --filter @tasks/api dev:session you@example.com`. Then in the browser: DevTools → Application → Cookies → add the printed name and value, and reload.

Stop with Ctrl+C. Postgres keeps running in the background; `docker compose down` stops it (the data stays).

### Your timetable in the local database

```sh
pnpm --filter @tasks/api dev:session you@example.com   # once: makes the user if it doesn't exist
pnpm --filter @tasks/api seed:private                   # your real timetable, from private/kiit-sem3.json
```

The seed writes to the database **on this laptop only** (it refuses any other) and replaces the group with the same name, so run it again after editing the file. It prints counts only. To try things without your real data, `seed:sample` loads the made-up sample timetable instead. How it works: [[Timetable files and seeding]].

What those commands run:

*From `apps/api/package.json` (shortened):*
```json
    "dev:session": "node --env-file-if-exists=../../.env src/scripts/dev-session.ts",
    "seed": "node --env-file-if-exists=../../.env src/scripts/seed.ts",
    "seed:sample": "node --env-file-if-exists=../../.env src/scripts/seed.ts fixtures/sample-timetable.json",
    "seed:private": "node --env-file-if-exists=../../.env src/scripts/seed.ts private/kiit-sem3.json",
```

`seed:sample` and `seed:private` are `seed` with the file filled in. To seed some other file, `pnpm --filter @tasks/api seed path/to/file.json`. The path is read from the repo root, wherever you run the command.

Your timetable is already seeded for `you@example.com` (21 series, checked against your golden weeks on 2026-10-13).

## Look inside

| You want | Command |
|---|---|
| The API's log | It's in the `pnpm dev` terminal, pretty-printed. Each request is one line with its `requestId` |
| A SQL prompt on the dev database | `docker compose exec db psql -U tasks tasks` (then `\dt`, `\d profile`; see [[Postgres and SQL basics]]) |
| The test database | `docker compose exec db psql -U tasks tasks_test` |
| Your classes, as stored | `docker compose exec db psql -U tasks tasks -c "select title, rule, start_time, location from series order by title"`. Note that `psql` logs in as `tasks`, a superuser, so row-level security doesn't apply here: you see every user's rows ([[Row-level security in our database]]) |
| What one week's API answer looks like | Sign in with `dev:session`, then `curl -H 'Cookie: <name>=<value>' 'http://localhost:5173/api/v1/calendar?from=2026-10-12&to=2026-10-18'` |
| What's running | `docker compose ps`, `docker ps` |
| Postgres's own log | `docker compose logs -f db` |
| Raw HTTP | `curl -i http://localhost:5173/healthz` ([[HTTP basics]]) |

## Reset

| You want | Command | Loses |
|---|---|---|
| Restart Postgres | `docker compose restart db` | Nothing |
| A brand-new, empty dev database | `docker compose down -v`, then `pnpm dev` | **All local data**: the test user, sessions, and your seeded timetable (run `dev:session` and `seed:private` again to get it back) |
| Re-install packages | `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm i` | Nothing |

## Before you push: run what CI runs

CI runs five jobs on every PR ([[Deploy and CI]]). These commands are their local twins, roughly fastest to slowest:

| CI job | Local command | Needs |
|---|---|---|
| Lint, typecheck and build | `pnpm check && pnpm typecheck && pnpm build` | — |
| Test API and web | `pnpm --filter "./apps/*" test` | Docker (the tests start Postgres themselves if it isn't running) |
| Test core | `pnpm --filter @tasks/core test:tz && pnpm --filter @tasks/core coverage` | — |
| Scan for secrets | `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 git /repo --redact` | Docker |
| Build and boot the image | See "Try the production image" below | Docker + buildx |

A sensible rhythm:
- **Every commit:** `pnpm check && pnpm typecheck`, plus the tests of the package you touched. `pnpm check:fix` fixes formatting by itself.
- **Before pushing or opening a PR:** the first three rows. `pnpm test` runs every package's tests at once.
- **When you touched the `Dockerfile`, `deploy/`, dependencies or anything about start-up:** also the image check.

You don't need to start Postgres before testing. The API tests' one-time setup (`apps/api/src/test/global-setup.ts`) tries to connect. If nothing answers on `localhost:5432`, it prints "Postgres isn't running … starting it with docker compose", runs `docker compose up -d --wait db`, and carries on. Postgres keeps running afterwards, like after `pnpm dev`.

*From `apps/api/src/test/global-setup.ts` (shortened):*
```ts
  try {
    return await connect(connectionString);
  } catch (error) {
    if (!isConnectionRefused(error) || !mayStartComposeDatabase(url)) {
      throw new Error(`The API tests need Postgres at ${url.host}, and it isn't answering.`, {
        cause: error,
      });
    }
  }

  console.log(`Postgres isn't running at ${url.host}; starting it with docker compose…`);
  try {
    execFileSync('docker', ['compose', 'up', '--detach', '--wait', 'db'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (error) { … }
  return connect(connectionString);
```

- Only "connection refused" (nothing listening) leads to starting Postgres. A wrong password, say, is a different error: the setup stops at once with "The API tests need Postgres at …", the original error attached as its `cause`.
- `execFileSync` runs a program and waits for it to finish. `--wait` makes Docker return only once the health check passes, so the second `connect` finds Postgres ready.
- `stdio: 'inherit'` shows Docker's own output in your terminal, which is why its error appears "just above" ours in the troubleshooting table below.

It deliberately does **not** do this:
- in CI (GitHub sets `CI=true`), where the workflow provides Postgres;
- when `TEST_DATABASE_URL` points somewhere other than this machine's port 5432, because that's your own server and not ours to start.

Both rules are one small function:

*From `apps/api/src/test/global-setup.ts`:*
```ts
function mayStartComposeDatabase(url: URL): boolean {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const composePort = (url.port || '5432') === '5432';
  return local && composePort && !process.env.CI;
}
```

`url.port` is the empty string when the URL leaves the port out, so `|| '5432'` fills in Postgres's default.

## Try the production image on your laptop

The exact image and stack the server will run, on `http://localhost:8080`:

```sh
# 1. Build the image, labelled with the current commit.
SHA=$(git rev-parse HEAD)
docker buildx build --load --build-arg GIT_SHA=$SHA -t tasks-local:$SHA .

# 2. Settings for the local "box" (deploy/.env is git-ignored).
cp deploy/env.example deploy/.env
#    then edit deploy/.env:
#      IMAGE=tasks-local   SITE_ADDRESS=http://localhost   HTTP_PORT=8080   HTTPS_PORT=8443
#      BETTER_AUTH_URL=http://localhost:8080
#      POSTGRES_PASSWORD=<openssl rand -hex 32>, and the same password inside DATABASE_URL
#      BETTER_AUTH_SECRET=<openssl rand -base64 32>
#      GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET = any placeholder text

# 3. Deploy it, exactly as the server will: dump, migrate, start, check the SHA.
deploy/deploy.sh $SHA

# 4. Check it.
curl -s http://localhost:8080/healthz          # "sha" must equal $SHA
cd deploy && docker compose -f compose.prod.yaml exec api node apps/api/src/scripts/dev-session.ts you@example.com
```

Paste the cookie into the browser at `http://localhost:8080` to see the signed-in app served by the production image. Clean up with `cd deploy && docker compose -f compose.prod.yaml down -v && rm .env deploy-history.log; rm -rf backups`.

What this proves that `pnpm dev` doesn't:
- the image builds;
- Node runs our TypeScript from inside it;
- the migrations apply from inside it;
- Caddy forwards correctly;
- the API serves the built PWA;
- the service worker installs.

**Checking offline opening (v0.2).** Only a production build has a service worker, so use this stack (or `pnpm build` + `pnpm --filter @tasks/web preview`). Open the calendar once online, then in Chrome's DevTools → Network, set the throttling menu to **Offline** and reload. The calendar should still draw your week, with "offline · last synced …" under the title bar ([[Offline reads]]). The same menu has "Slow 4G" and "Fast 4G" presets, the closest your laptop gets to your phone on campus data.

**A quicker image check.** Without the whole Compose stack, the image can run against the dev database directly, the way CI's "Build and boot the image" job does: `docker run --rm --network host -e DATABASE_URL=postgres://tasks:tasks@127.0.0.1:5432/tasks -e BETTER_AUTH_URL=http://localhost:3000 -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) -e GOOGLE_CLIENT_ID=x -e GOOGLE_CLIENT_SECRET=x -e AUTH_ALLOWED_EMAILS=you@example.com tasks-local:$SHA`, then open `http://localhost:3000`. Stop `pnpm dev`'s API first (it also wants port 3000). This skips Caddy, so it doesn't check compression or HTTPS.

For comparison, CI's version of the same check, which also migrates first:

*From `.github/workflows/ci.yml` (shortened):*
```sh
          vars=(-e DATABASE_URL -e BETTER_AUTH_URL -e BETTER_AUTH_SECRET -e GOOGLE_CLIENT_ID
                -e GOOGLE_CLIENT_SECRET -e AUTH_ALLOWED_EMAILS)
          docker run --rm --network host "${vars[@]}" tasks:ci node apps/api/src/db/migrate.ts
          docker run -d --name api --network host "${vars[@]}" tasks:ci
          # …
          test "$sha" = "$GITHUB_SHA"
```

- `vars=( … )` is a bash list of arguments, and `"${vars[@]}"` pastes the whole list into each `docker run`. `-e NAME` with no `=value` copies that variable from the shell into the container; the job sets them a few lines earlier.
- The first `docker run` replaces the image's start command with `node apps/api/src/db/migrate.ts`, so it migrates and exits. The second runs the image's own command (the API) in the background (`-d`).
- `--network host` lets the container reach Postgres on `127.0.0.1:5432`, the same reason your local command uses it.

## From change to merged

```mermaid
flowchart TD
  br["branch off release/x"] --> code["change code"] --> quick["pnpm check, typecheck,<br/>that package's tests"]
  quick --> commit["commit, one concern"]
  commit -->|"more to do"| code
  commit --> full["before pushing: pnpm test,<br/>test:tz, coverage, build<br/>image check if Docker or deploy changed"]
  full --> merge["merge into release/x with --no-ff"] --> push["push, open the PR"] --> ci["CI runs the same checks"]
```

The house rules (from your global setup):
1. Branch off the integration branch: `git switch -c feat/<topic> release/<x>`. Branch types: feat, fix, chore, docs, refactor, perf, test.
2. Small commits, one concern each, each passing check and typecheck. Messages look like `feat(api): add the calendar route`.
3. Merge back with `git merge --no-ff feat/<topic>`. That keeps the branch's commits as a visible side rail in the history; never squash.
4. Push the release branch and open one PR to `main`. CI runs. Merge on GitHub when it's green. After the first deploy, merging also ships it.

## When something's wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `permission denied … docker API` | Group membership not active | Log out and in |
| `Port 5173 is in use` | An old Vite is still running | Stop it; `ss -ltnp \| grep 5173` shows the process |
| API tests: "Couldn't start Postgres with `docker compose up …`" | Docker itself failed; its own message is printed just above | Usually the docker group (log out and in), or Docker isn't running (`systemctl start docker`) |
| Sign-in button: "Google sign-in isn't set up" | No `GOOGLE_CLIENT_ID` in `.env` | Expected locally; use `dev:session` |
| `pnpm check` complains about formatting | Spacing or quotes | `pnpm check:fix` |
| `docker: unknown command: docker buildx` | Plugin missing | `sudo pacman -S docker-buildx` |
| `pnpm check`: "Found a nested root configuration" | A copy of the repo (a git worktree) under `.claude/worktrees/` has its own `biome.json` | Remove the worktree (`git worktree remove <path>`), or check just your folders: `pnpm exec biome check apps packages` |
| The offline badge never shows under `pnpm dev` | No service worker in dev, so offline nothing loads at all | Check offline with a production build (above) |
| The calendar is empty after `docker compose down -v` | The volume (and your seeded timetable) was deleted | `dev:session`, then `seed:private` |

## Check yourself
- You changed only `apps/web/src/routes/login.tsx`. Which checks would you run before pushing, and which can you skip?
- You ran `docker compose down -v`. What did you lose, and what recreates the tables the next time you run `pnpm dev`?
- Why does the production check use `deploy/deploy.sh` instead of plain `docker compose up`? Name two things it does that `up` doesn't.
- CI's "Test API and web" starts its own Postgres. Where does your laptop's test run get one?
