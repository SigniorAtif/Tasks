# Containers and images

> **Builds on:** [[HTTP basics]]

Why the app ships as a "Docker image", and what actually runs on the box. Where it's used: [[Deploy and CI]]. Why these choices: [[Deploy choices]].

## The problem they solve

The API needs Node 24, exact versions of about forty packages, and our source files laid out a certain way. Your laptop runs Arch, the box will run Ubuntu, and GitHub's CI machines run something else again. Installing everything by hand on each one is how "works on my machine" bugs are born.

## An image is an APK for a server

An **image** is a frozen, read-only bundle: a small Linux userland, Node, our code and its dependencies, plus a few settings (environment variables, which user to run as, the start command). It's built once and runs the same everywhere, much like an APK you install on any Android phone without recompiling the app.

A **container** is one running copy of an image: a normal process on the host, but fenced off so it sees only the image's files, its own network address and its own process list. Unlike a virtual machine it doesn't boot a second operating system; it shares the host's Linux kernel, so it starts in about a second and costs almost nothing extra.

| Word | Example from this repo |
|---|---|
| Image | `ghcr.io/signioratif/tasks:<commit SHA>`, built from the `Dockerfile` |
| Container | `tasks-prod-api-1`, the API running on the box |
| Registry | GHCR (GitHub Container Registry): the Play Store for images. CI uploads ("pushes"), the box downloads ("pulls") |
| Base image | `node:24.21.0-alpine3.24`: someone else's image we build on top of |

## How an image is built

A `Dockerfile` is a recipe. Each instruction (`COPY`, `RUN`) adds a **layer**, a snapshot of the files it changed. Docker caches layers and reuses them when the instruction and its inputs haven't changed. So order matters: copy the lockfile and install dependencies *first*, copy the source *after*. A code-only change then reuses the expensive install layer and rebuilds in seconds.

Our first stage does exactly that:

*From `Dockerfile` (shortened):*
```dockerfile
WORKDIR /app
# Download every package the lockfile lists into pnpm's store. This step needs only the
# lockfile, so Docker reuses its result until the lockfile changes: a code-only change
# skips the download entirely.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# Link the web app's dependencies from the store (no network), then build it.
RUN pnpm install --offline --frozen-lockfile --filter @tasks/web... \
  && pnpm --filter @tasks/web build
```

- `COPY pnpm-lock.yaml pnpm-workspace.yaml ./` brings in just two files. As long as they're unchanged, Docker skips the `RUN pnpm fetch` below it (the slow download) and uses its cached layer.
- `COPY . .` brings in everything else. Any code change invalidates the cache from this line down, but the download is already done.
- `--offline` proves the point: the install must find every package in what `pnpm fetch` already downloaded.

**Multi-stage builds** use several throwaway "stages" and copy only results into the final one. Ours builds the PWA in a stage that has Vite, TypeScript and the rest of the dev tools, then copies just the built `dist/` folder into the final image. The tools never ship.

The **build context** is the set of files `docker build` is allowed to read. `.dockerignore` decides it. Anything excluded can't end up in an image, which is how `private/` (your real timetable) is kept out of an image anyone can download.

Ours is an allowlist: it shuts everything out, then lets back in only what the image is built from:

*From `.dockerignore` (shortened):*
```sh
# Rule 1: deny everything.
*

# Rule 2: allow back only what the image is built from.
!package.json
!pnpm-lock.yaml
!pnpm-workspace.yaml
!tsconfig.base.json
!apps/
!packages/
# …
# Rule 4: named explicitly even though rule 1 already covers them. Later lines win, so
# these stay out even if someone adds a broader "!" line above by mistake.
private
vault
.env
# …
```

`*` matches every file, and a `!` line brings one back. A new folder at the top of the repo is therefore *out* by default: forgetting to list something can make a build fail, but never leaks it into the image.

## Under the hood: what "fenced off" means

A container is not a little computer. It's an ordinary Linux process that the kernel shows a restricted view of the world. Three kernel features do it:

- **Namespaces** change what the process can *see*. The PID namespace gives it its own process list (our API is process 1 inside, though on the host it has some ordinary number). The mount namespace gives it its own filesystem, the image's. The network namespace gives it its own network interface and IP address on a Docker network, so `api` and `db` can each use their usual port without clashing.
- **cgroups** (control groups) limit what it can *use*: CPU, memory, number of processes. A runaway process in one container can't starve the host.
- **A layered filesystem** (overlayfs) stacks the image's read-only layers and puts one thin writable layer on top for the container. Two containers from the same image share the read-only layers on disk; anything a container writes goes into its own top layer and **disappears when the container is removed**.

That last point is why data needs a **volume**. A volume is a folder Docker manages on the host's disk (`/var/lib/docker/volumes/...`), mounted into the container at a path. Postgres writes to `/var/lib/postgresql`, which is a volume, so deleting and recreating the `db` container, or deploying a new API image, never touches your data. Only `docker compose down -v` (`-v` for volumes) deletes it. See [[Docker Compose]].

`dockerd` (the Docker daemon) is the background service that does all of this; the `docker` command only sends it requests through the socket `/var/run/docker.sock`. That socket is root-owned and group `docker`, which is why your user needs to be in that group.

## Our Dockerfile, stage by stage

| Stage | Starts from | Does | Ends up in the image? |
|---|---|---|---|
| `web-build` | `node:24…-alpine`, on the build machine's own CPU | `pnpm fetch` (download every package from the lockfile), copy the source, install the web app's dependencies, `vite build` | Only `apps/web/dist` |
| `prod-deps` | the same base, on the image's CPU (amd64 or arm64) | Install only the API's runtime dependencies (`--prod --filter @tasks/api...`) | Its `node_modules` |
| `runtime` | the same base | Copy `prod-deps`' files, the API source, `packages/core/src`, the migrations and the built PWA; set the env, `USER node`, `CMD node apps/api/src/main.ts` | This *is* the image |

`GIT_SHA` is set last, because it changes every commit and would otherwise invalidate the cache of everything after it.

## Tags and digests

- A **tag** is a name: `node:24-alpine`. Its owner can point it at a new image tomorrow.
- A **digest** is a fingerprint of the exact content: `@sha256:ebfe2f90…`. Change one byte and the digest changes, so it can't be moved.

We write both (`node:24.21.0-alpine3.24@sha256:…`): the tag for humans, the digest so a rebuild next month uses the identical base.

## CPU types

Phones and Oracle's free Ampere servers use **arm64** CPUs; most laptops and VPSs use **amd64** (x86). A program compiled for one doesn't run on the other. One image tag can hold a version for each, and the box pulls the one matching its CPU. That's a **multi-arch** image.

## Alternatives

- **Install Node on the box and run the app with systemd.** Fewer moving parts, but the box's setup becomes a hand-made, hard-to-reproduce thing, and upgrading Node means touching the server.
- **A virtual machine image.** Full isolation, but gigabytes and minutes to boot.
- **A platform (PaaS) that builds for you**, like Render or Railway. Less to learn, but less control and a monthly cost once the app needs to run all the time (D-064).

## Check yourself
- You change one line in `apps/api/src/main.ts` and rebuild. Which Dockerfile steps run again, and which come from the cache? Why?
- Someone adds `!private/` to `.dockerignore` "by mistake". Does the timetable end up in the image? (Hint: read the last block of `.dockerignore`.)
- The box is an Oracle Ampere A1. What would happen if CI built the image only for amd64?
