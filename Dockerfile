# syntax=docker/dockerfile:1

# The production image: the API, run straight from its TypeScript source, plus the built
# PWA, which the API serves itself (Caddy only forwards requests to it).
#
#   docker build --build-arg GIT_SHA="$(git rev-parse HEAD)" -t tasks .
#
# Three stages; only the last one becomes the image:
#   web-build  installs everything and builds the PWA (apps/web/dist)
#   prod-deps  installs only what the API needs at runtime
#   runtime    the image: Node, those dependencies, the source and the built PWA

# Node 24 on Alpine Linux. The digest pins the exact image (for every CPU type), so a
# rebuild next month gets the same base unless this line changes.
ARG NODE_IMAGE=node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# Same as `packageManager` in package.json.
ARG PNPM_VERSION=12.10.1

# ---- web-build -------------------------------------------------------------------------
# Runs on the CPU of the machine doing the build ($BUILDPLATFORM), even when the image is
# for arm64: the PWA is plain HTML, JS and CSS, identical for every CPU, so there is no
# need to emulate another CPU (slow) to build it.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web-build
ARG PNPM_VERSION
# npm warns that it skipped pnpm's install script. That's fine: the script only swaps a
# small launcher for pnpm's native binary, and pnpm works the same without it.
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
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

# ---- prod-deps -------------------------------------------------------------------------
# Runs on the image's own CPU type, so any package with a CPU-specific binary gets the
# right one. Only the manifests are copied, so this stage is reused until a dependency
# changes. If the API ever depends on another workspace package, add its package.json here.
FROM ${NODE_IMAGE} AS prod-deps
ARG PNPM_VERSION
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
# `--prod` skips devDependencies; `@tasks/api...` means the API plus the workspace
# packages it depends on (@tasks/core). pnpm links @tasks/core as a symlink to
# packages/core, which matters: Node refuses to run TypeScript from inside node_modules,
# and through the symlink the files' real path is /app/packages/core/src, outside it.
RUN pnpm install --frozen-lockfile --prod --filter @tasks/api...

# ---- runtime ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# HOST=0.0.0.0: inside a container, 127.0.0.1 would only be reachable from the container
# itself, so Caddy (another container) couldn't connect. TZ=UTC: the server never assumes
# India time; each user's zone is data.
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  STATIC_DIR=/app/apps/web/dist \
  TZ=UTC
# Dependencies first (they change rarely), then the source (changes every commit), so a
# code-only change rebuilds just the last few layers.
COPY --from=prod-deps /app ./
COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
COPY --from=web-build /app/apps/web/dist apps/web/dist

# Last, because it changes on every commit and would otherwise invalidate the layers above.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="tasks" \
  org.opencontainers.image.description="Calendar and tasks planner: API and PWA" \
  org.opencontainers.image.source="https://github.com/SigniorAtif/Tasks" \
  org.opencontainers.image.revision="${GIT_SHA}" \
  org.opencontainers.image.licenses="MIT"

# The files above belong to root and are read-only for `node` (an unprivileged user the
# base image already has), so a bug in the app can't rewrite the app.
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/main.ts"]
