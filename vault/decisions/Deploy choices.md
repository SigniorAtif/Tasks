# Deploy choices

The choices behind the image, the box's stack, the deploy script and CI (v0.0, the "Box" and "CI/CD" bullets of `docs/brainstorm/00-overview.md` §5). Versions were checked on 2026-10-12. Concepts: [[Containers and images]], [[Docker Compose]], [[Reverse proxies and TLS]], [[CI and CD]], [[Secret scanning]]. How it fits together: [[Deploy and CI]].

## Versions

| Thing | Version | Pinned as |
|---|---|---|
| Base image | Node 24.21.0 on Alpine 3.24 | `node:24.21.0-alpine3.24@sha256:ebfe2f90…` |
| pnpm in the image | 12.10.1 | same as `packageManager` |
| Caddy | 2.11.7 | `caddy:2.11.7@sha256:f2a1290d…` |
| Postgres (box and CI) | 18.6 | `postgres:18.6@sha256:74935e72…` |
| gitleaks | 8.30.1 | `zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0…` |
| Actions | checkout 7.0.1, setup-node 7.1.0, pnpm/action-setup 6.1.0, docker setup-buildx 4.4.1, setup-qemu 4.4.0, login 4.6.0, build-push 7.4.0 | full commit SHAs |
| Checked with | actionlint 1.7.12, ShellCheck 0.11.0 | not in the repo |

Digests and SHAs don't update themselves. A Dependabot or Renovate setup to propose updates is listed as later work in `deploy/README.md`.

## One box, Compose, Caddy, Cloudflare (D-064)

One VPS (Oracle Always Free Ampere A1 if it can be had in one evening, else a 2 GB India VPS), with Docker Compose running Caddy, the API and Postgres, and Cloudflare's free plan in front.

The app will need an always-on process (reminders), and that makes free "scale to zero" platforms paid. An Indian box keeps round trips at 5-40 ms. And one box is cheap, and you can explain every part of it.

What lost: a platform plus managed Postgres (an always-on process burns through free tiers), Kubernetes (built for fleets), and a Hetzner box in Europe (140+ ms away).

## The image

- **Alpine base.** It's small, and it's the official Node image. A test build with stub apps measured 243 MB unpacked (the Node base alone is 242 MB) and 62 MB to download; the real API's packages add to that. The alternatives: `node:24-slim`, which is Debian (bigger, but glibc, which some native packages prefer; switch if a dependency misbehaves on Alpine's musl), and distroless (a smaller attack surface, but no shell for debugging).
- **No build step for the API.** Node 24 runs `.ts` files directly. Compiling to JavaScript with `tsc` or esbuild would be one more step and source maps to manage, for no gain here.
- **The trap:** Node won't strip types from files under `node_modules`. pnpm links `@tasks/core` as a symlink to `packages/core`, and Node follows symlinks to the real path, so it works. That's why the image doesn't use `pnpm deploy`, which copies packages *into* `node_modules`. Verified in a test build: `@tasks/core` resolved to `/app/packages/core/src/index.ts`.
- **Three stages.** `web-build` runs on the build machine's own CPU even when targeting arm64, because the PWA is the same HTML/JS for every CPU. `prod-deps` runs per CPU type, so a package with a native binary would get the right one. `runtime` copies only the results. Building everything under emulation for each CPU would be correct too, but several times slower.
- **`pnpm fetch` first.** It downloads every package from the lockfile alone, so that layer is reused until dependencies change. The store lives in the layer, not in a BuildKit cache mount: a cache mount is empty on a fresh CI machine, while a layer can come back from GitHub's cache.
- **Root-owned files, run as `node`,** so the app can't modify itself.
- **`.dockerignore` is an allowlist.** "Deny everything, allow `apps/`, `packages/` and four root files" means a new folder at the root (like `private/`) is excluded without anyone remembering to add it. The private names are also listed explicitly at the end, where later lines win. Verified by exporting the build context (no `private/`, `vault/`, `.env*`, tests or `node_modules`) and by searching the built image for decoy files.
- **The API serves the PWA** (from the v0.0 contracts): one image, one container, one origin, and Caddy only proxies. The alternative (07 §5.7) was a second image with Caddy serving the static files: two images to keep in step, for a speed-up one user won't notice.

## Images: GHCR, multi-arch

- **GHCR** (`ghcr.io/signioratif/tasks`) is free for public images, and CI pushes with its own token, so there's no Docker Hub account or extra secret. Make the package public once (runbook step 6), or log the box in with a read-only token.
- **amd64 and arm64**, because the box's CPU isn't decided yet. QEMU emulation on the x86 runner handles the small per-CPU stage. Native ARM runners and a merge step would be faster, but cost twice the workflow YAML.
- **Tags:** the full commit SHA (what deploys use, and never reused) and `main` (a convenience).

## Deploying

- **Gated by `DEPLOY_ENABLED`.** Merging before the box exists shows the deploy job as skipped, not failed.
- **Over SSH with a pinned host key.** `DEPLOY_KNOWN_HOSTS` holds the box's key, so SSH refuses an impostor. Never `StrictHostKeyChecking=no`.
- **Pre-deploy dump, then migrate, then swap (D-066).** The dump is the undo button for data. Migrations run once, in a one-off container, before any API swap.
- **Rollback, but never down-migrations.** Migrations only add (expand/contract), so the previous API works on the new schema, and an app rollback is always safe. Undoing data means restoring a dump. "Down" migration scripts would be untested code that runs at the worst moment.
- **The deployed tag lives in `.env`'s `TAG` line.** `deploy.sh` reads it as the rollback target and rewrites it after a success, so plain `docker compose` commands on the box use the deployed version too. There's also an append-only `deploy-history.log`.
- **Smoke test twice:** from inside the API container (did the new code start?) and through the public URL (do DNS, Cloudflare and Caddy reach it?).
- **Old images are deleted** after a success, keeping the current and previous ones, so a small disk doesn't fill up.
- **Verified** with a fake `docker` command that simulated each outcome: first deploy, normal deploy, wrong SHA (rolled back), unhealthy containers (rolled back), failed migration, failed dump, failed pull, same tag twice, bad tag, a second deploy while one runs, and dump pruning.

## Caddy and Cloudflare

- **Visitor IP:** trust `CF-Connecting-IP` only from Cloudflare's ranges, and hand the API a single `X-Forwarded-For`. Checked by experiment (see [[Reverse proxies and TLS]]).
- **Timeouts:** 10 s to send headers, 30 s for a request body, 2 min idle. There's no write timeout, because it would cut long responses such as live updates later.
- **HSTS** for a year, HTTPS only, no `includeSubDomains`, no preload.
- **Grey cloud first, then proxied.** Cloudflare's Full (strict) needs Caddy's certificate to exist, and Caddy can only get one once Let's Encrypt reaches the box directly.
- **Cloudflare's "Always Use HTTPS" stays off**, unlike the brainstorm's suggestion (07 §5.9). Caddy already redirects HTTP to HTTPS, and leaving it off keeps Let's Encrypt's plain-HTTP renewal check able to reach Caddy through Cloudflare.

## Postgres

No published port, on an `internal` network (no internet either), with the volume mounted at `/var/lib/postgresql` (Postgres 18 refuses the old `/data` mount). Every container's logs rotate at 10 MB × 3.

## CI

- **Five jobs in parallel**, each name a required check: `Lint, typecheck and build`, `Test API and web`, `Test core`, `Scan for secrets`, `Build and boot the image`. Expected total: about 3 minutes, under D-018's 5.
- **Core runs four times, not five:** three time zones, plus once with coverage. The plain `pnpm test` isn't run for core, since the time-zone runs already cover it.
- **The web app's own `test:tz` script isn't run in CI.** Its tests run once, in `Test API and web`. To put the web app under the time-zone matrix too, add it to the `Test core` job's filter.
- **The image is booted, not just built**, against a real Postgres: migrations, startup, and `/healthz` reporting the commit. A build alone wouldn't catch a file missing from the image.
- **gitleaks runs from its pinned Docker image**, not the gitleaks GitHub Action, so the same command runs locally and in CI, and there's no licence question.

## Check yourself
- Why does the image *not* use `pnpm deploy`, the usual way to bundle one package of a pnpm workspace?
- Which single repository variable decides whether a merge to `main` touches the box?
- After a rollback, why is it fine that the database keeps the new migration?
- Name two things the `Build and boot the image` job catches that `Lint, typecheck and build` can't.
