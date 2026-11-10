# Repo root and tooling

> **Background:** [[Monorepo and workspaces]] · [[TypeScript checking vs running]]

What every file at the top of the repo does. Why each tool was picked is in [[Tooling choices]].

## Files

| File | What it does |
|---|---|
| `package.json` | The root "package". Private (never published). Holds repo-wide scripts and the tools every package shares (Biome, TypeScript). Pins pnpm with `packageManager` and the Node floor with `engines` |
| `pnpm-workspace.yaml` | Says which folders are packages: `apps/*` and `packages/*`. See [[Monorepo and workspaces]] |
| `pnpm-lock.yaml` | Exact versions and checksums of every installed package. Generated; never edit by hand; always commit |
| `tsconfig.base.json` | The shared TypeScript rules. Each package's `tsconfig.json` extends it. See [[TypeScript checking vs running]] |
| `biome.json` | Lint and format rules, including the `Date`/`Temporal` ban |
| `.node-version` | `24`. Version managers (fnm, mise, asdf) read it to pick Node |
| `.gitignore` | `node_modules/`, `coverage/`, `.env` files and `vault/` never get committed |
| `LICENSE` | MIT (decided in [[First-commit decisions]]) |
| `README.md` | What the project is, and the commands below |
| `fixtures/` | Made-up example files that are part of the public repo: `sample-timetable.json` (v0.2) |
| `private/` | **Not in git** (listed in `.gitignore`): your real timetable and the hand-checked weeks. Read only by `seed:private`, on your laptop |
| `compose.yaml` | The development Postgres ([[Docker Compose]]) |

Three rows, up close. First, how the root `package.json` pins the tools:

*From `package.json` (shortened):*
```json
  "name": "tasks",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.10.1",
  "engines": {
    "node": ">=24"
  },
```

- `"private": true` stops `pnpm publish` from ever uploading the repo to npm by accident.
- `packageManager` names one exact pnpm. Corepack and CI's `pnpm/action-setup` read it, so everyone runs the same pnpm.
- `engines` is a floor, not a pin: Node 24 or newer. `.node-version` says which one to actually install.

Then the `Date`/`Temporal` ban in `biome.json`. The `Temporal` part applies everywhere, and this override adds `Date` for `packages/core` only:

*From `biome.json` (shortened):*
```json
  "overrides": [
    {
      "includes": ["packages/core/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedGlobals": {
              "level": "error",
              "options": {
                "deniedGlobals": {
                  "Temporal": "Import { Temporal } from 'temporal-polyfill'. Native Temporal is missing in Safari and some Node builds.",
                  "Date": "packages/core is pure: use Temporal from temporal-polyfill, and take `now` as a parameter instead of reading the clock (D-015)."
                }
```

`noRestrictedGlobals` is a Biome rule that forbids using a global name you list, and the text after each name is the error message you see. The override writes the rule's list out in full for those files, so `Temporal` appears again, now joined by `Date`.

And what `.gitignore` keeps out:

*From `.gitignore` (shortened):*
```sh
# Personal learning vault (Obsidian), kept local
vault/
# …
# Local environment (secrets never get committed)
.env
.env.*
!.env.example

# Personal data (the real timetable, seeds): never committed, the repo is public
private/
```

`.env.*` ignores every `.env.something`, and the next line, `!.env.example`, takes one back: a `!` un-ignores. The example file holds no secrets, only the names of the settings, so it belongs in git.

## `packages/core`

| File | What it does |
|---|---|
| `package.json` | Name `@tasks/core`; `exports` points at the TypeScript source; scripts for tests and typecheck |
| `tsconfig.json` | Extends the base config; checks `src/` and `vitest.config.ts` |
| `vitest.config.ts` | Where tests are, the setup file, the coverage gate (90% of branches in `src/recurrence/`) and a 60 s timeout for slow property tests |
| `src/index.ts` | The package's public face: everything other packages may import |
| `src/types.ts` | Every shared name. See [[Core types]] |
| `src/api.ts` | The HTTP contract: paths, response shapes, error codes. See [[Calendar API]] |
| `src/schemas.ts` | The zod rules both the API and the form use (v0.2). See [[Validating input with schemas]] |
| `src/palette.ts` | The ten group colours (v0.2) |
| `src/timetable.ts` | The timetable file format (v0.2). See [[Timetable files and seeding]] |
| `src/recurrence/` | The recurrence engine and its tests. See [[Recurrence engine]] |
| `src/test/` | Test helpers: `builders.ts` (small factories), `arbitraries.ts` (random inputs), `setup.ts` (1,000 runs per property) |

The `package.json` and `vitest.config.ts` rows, up close:

*From `packages/core/package.json` (shortened):*
```json
  "name": "@tasks/core",
  // …
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:tz": "TZ=UTC vitest run && TZ=Asia/Kolkata vitest run && TZ=America/New_York vitest run",
    "coverage": "vitest run --coverage"
  },
```

- `exports` says what `import … from '@tasks/core'` loads: the TypeScript file `src/index.ts`, with no build step in between ([[TypeScript checking vs running]]).
- `test:tz` is three runs joined by `&&`, which means "only if the previous one passed". `TZ=UTC vitest run` sets the machine's time zone for that one command.

*From `packages/core/vitest.config.ts` (shortened):*
```ts
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Property tests run 1,000 cases each; with coverage on, a few take longer than the 5 s default.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/recurrence/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__fixtures__/**'],
      // The only coverage gate in the repo (D-017): the recurrence engine, where bugs are subtle.
      thresholds: { branches: 90 },
    },
```

`coverage.include` is why the gate covers only the engine: other files aren't measured at all. `60_000` is just `60000`; the `_` is a digit separator, for readability.

## Commands

Run these from the repo root. `pnpm -r` means "in every package that has this script".

*From `package.json` (shortened):*
```json
  "scripts": {
    "dev": "docker compose up -d --wait db && pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    // …
    "check": "biome check .",
    "check:fix": "biome check --write .",
    "typecheck": "pnpm -r run typecheck",
    "test": "pnpm -r run test",
    "test:tz": "pnpm -r run test:tz",
    "coverage": "pnpm -r run coverage"
  },
```

The root scripts mostly fan out: `pnpm test` runs `test` in every package that has one. Not every package has every script, though. `pnpm test:tz` reaches `packages/core` and `apps/web` (the API has no `test:tz`), and `pnpm coverage` reaches only `packages/core`. `dev` and `build` are covered in [[Local workflow]].

| Command | What it runs |
|---|---|
| `pnpm install` | Installs everything the lockfile lists |
| `pnpm test` | All tests, once |
| `pnpm test:tz` | Core's and the web app's tests three times, under `TZ=UTC`, `Asia/Kolkata` and `America/New_York`. The machine's zone must never change the results |
| `pnpm coverage` | Tests plus the coverage report; fails if branch coverage on the engine drops below 90% |
| `pnpm typecheck` | `tsc --noEmit` in every package (twice in the web app: once for the browser code, once for its config files, each with its own tsconfig) |
| `pnpm check` / `check:fix` | Biome lint and format; `check:fix` rewrites files |

Inside `packages/core`, `pnpm test:watch` reruns the tests on every save.

## Check yourself
- Which file would you edit to make `noUncheckedIndexedAccess` stricter or looser for every package at once?
- Where is the 90% coverage gate configured, and why does it apply only to `src/recurrence/`?
- You add a new package under `packages/`. What do you have to do so pnpm treats it as part of the workspace?
