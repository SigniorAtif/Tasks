# Monorepo and workspaces

> **Builds on:** nothing. A starting point.

A **monorepo** is one git repository holding several programs that belong together. Ours holds three:

- `apps/web`: the PWA (what runs in your browser and phone)
- `apps/api`: the server
- `packages/core`: code both of them use

The alternative is one repo per program ("polyrepo"). Then sharing `core` means publishing it as a package, bumping its version and updating both apps every time it changes. With one repo, a change to `core` and the apps that use it lands in **one commit**, and one test run checks all of them together.

## Packages and `package.json`

Each folder with a `package.json` is a **package**: a unit with a name, its own dependencies and its own scripts. Ours is called `@tasks/core`. The `@tasks/` part is a *scope*, a namespace so the name can't clash with someone else's `core` on npm.

Two kinds of dependency:
- **`dependencies`**: needed when the code runs. `core` needs `temporal-polyfill` at runtime.
- **`devDependencies`**: needed only while developing: the compiler, the linter, the test runner, the test oracle (`rrule-temporal`). They never ship to users.

Core's own `package.json` shows both lists:

*From `packages/core/package.json` (shortened):*
```json
  "dependencies": {
    "temporal-polyfill": "1.0.5",
    "zod": "4.6.6"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "5.0.3",
    "fast-check": "4.10.2",
    "rrule-temporal": "2.2.8",
    "typescript": "7.0.2",
    "vitest": "5.0.3"
  }
```

`zod` is a runtime dependency too: the request rules in `schemas.ts` run on every request the API gets. Everything under `devDependencies` is for checking and testing, which is why the production image installs with `--prod` and leaves those out ([[Containers and images]]).

## Workspaces

A **workspace** is the package manager's word for "these folders are packages in one monorepo". `pnpm-workspace.yaml` lists them with patterns:

*From `pnpm-workspace.yaml` (shortened):*
```yaml
packages:
  - apps/*
  - packages/*
# …
```

When `apps/api` lists `"@tasks/core": "workspace:*"` as a dependency (it has since v0.0), pnpm doesn't download anything. It puts a **symlink** (a shortcut to another folder) in `apps/api/node_modules/@tasks/core` that points to `packages/core`. Edits to `core` are visible to the API immediately.

*From `apps/api/package.json` (shortened):*
```json
  "dependencies": {
    "@hono/node-server": "2.1.4",
    "@tasks/core": "workspace:*",
    "better-auth": "1.7.7",
    // …
  },
```

`workspace:*` means "the copy of `@tasks/core` in this repo, whatever its version". Every other line names an exact version from npm. The same symlink is what lets the production image run core's TypeScript directly ([[Deploy and CI]]).

## The lockfile

`package.json` says what you want (`"vitest": "5.0.3"`). But vitest itself depends on about 50 other packages, and *their* versions float. `pnpm-lock.yaml` records the **exact** version of every package in the whole tree, plus a checksum of each one.

- Commit it. Then everyone (you on another laptop, CI, the server) installs byte-identical dependencies.
- Without it, "works on my machine" bugs appear when a sub-dependency releases a new version between two installs.
- The checksums mean a tampered package fails to install. pnpm 12 also runs a supply-chain check on the lockfile when installing (it prints "Lockfile passes supply-chain policies").

We also pin our direct dependencies **exactly** (`5.0.3`, not `^5.0.3`). A caret means "any 5.x.y at or above this", so an install next month could quietly get a different version. Exact pins change only when we choose to upgrade.

## Why pnpm

See [[Tooling choices]]. In short: it stores each package version once on your disk and links it into projects, and it's strict, so a package can only import what it actually declares.

## Check yourself
- `core` needs `temporal-polyfill` when the app runs, but `fast-check` only in tests. Which list does each go in, and what would go wrong if `temporal-polyfill` were in `devDependencies`?
- You delete `pnpm-lock.yaml` and run `pnpm install`. What could be different afterwards, even though `package.json` didn't change?
- Why does a symlink make a monorepo nicer than publishing `core` to npm?
