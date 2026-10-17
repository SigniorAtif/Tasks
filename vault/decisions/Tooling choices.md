# Tooling choices

The tools behind the monorepo scaffold (v0.0, first bullet of `docs/brainstorm/00-overview.md` §5). Versions were the latest stable on 2026-10-10 unless the plan said otherwise. Concepts: [[Monorepo and workspaces]], [[TypeScript checking vs running]].

## Package manager: pnpm 12.10.1

- **Chosen because:** each package version is stored once on disk (in `~/.local/share/pnpm/store`) and *hard-linked* into projects, so ten projects using vitest don't keep ten copies. It's strict: a package can only import what its own `package.json` lists, which catches "works by accident" imports. Workspaces are built in.
- **Alternatives:** npm (ships with Node; slower, and it "hoists" everything into one flat `node_modules`, so undeclared imports silently work), Yarn (fine, less common now), Bun (fast, but also a different runtime; we run on Node).
- **Pinned** via `"packageManager": "pnpm@12.10.1"`. Any pnpm you run switches itself to that version, so everyone resolves dependencies the same way.
- **Install it:** `sudo pacman -S pnpm` (Arch has 12.10.1). Until then, `npx pnpm@12.10.1 <command>` works without installing.

## TypeScript 7.0.2 (switched from 6.0.3 on 2026-10-11)

- **What changed:** TypeScript 7 is the same language with its checker rewritten in Go, so it's much faster. Checking `core` went from about 1 s to 0.15 s.
- **Why the plan said 6:** the plan's reason (03 §5.12, 99 §2.5) was that `typescript-eslint`, the ESLint add-on for TypeScript, doesn't support 7 yet. **That never applied to us:** we use Biome, not ESLint, and Biome doesn't use the TypeScript compiler at all. Vitest doesn't either; it only strips types.
- **Your call (2026-10-11):** use the latest TypeScript.
- **Verified before switching:** typecheck, Biome and all 98 tests pass on 7.0.2. A probe file with two deliberate mistakes (a misspelt cancel reason, an unchecked array read) still failed with the right errors, so 7 checks as strictly as 6 did.
- **Risk:** 7.0 is about three months old. If an editor plugin or a future tool needs the old compiler's JavaScript API, pin `6.0.3` again: it's a one-line change.

## Biome 2.5.15 for lint and formatting

- A **linter** finds suspicious code (unused variables, `==` instead of `===`, banned functions). A **formatter** rewrites code into one consistent layout, so diffs show real changes, never spacing.
- **Chosen because:** one fast tool, one config file (`biome.json`), no plugins to keep in sync.
- **Alternative:** ESLint + Prettier, the long-time standard. More rules and plugins, but two tools, two configs, and slower. Biome covers what we need.
- **To be clear:** Biome *replaces* ESLint and Prettier; it isn't an add-on to them. This repo has never used ESLint.
- **Our custom rule:** `noRestrictedGlobals`.
  - Everywhere: the *global* `Temporal` is banned. You must `import { Temporal } from 'temporal-polyfill'`. Native Temporal is missing in Safari and in this machine's Node build.
  - In `packages/core` only: `Date` is banned too. `Date` reads the clock (`new Date()`, `Date.now()`) and depends on the machine's time zone. Core must be pure: same input, same output, on any machine (D-015). Code that needs "now" takes it as a parameter.
  - Tested by hand: a probe file with `new Date()` in core and in an app failed exactly as intended.

## Vitest 5.0.3 for tests

- **Chosen because:** it runs TypeScript directly, it's fast, and it has file snapshots (used for the golden weeks) and coverage built in. The same tool will test the web app, which uses Vite.
- **Alternatives:** Jest (older, needs extra setup for TypeScript and ES modules), Node's built-in `node:test` (no snapshots or coverage thresholds in the box).
- **Helpers:** `fast-check` 4.10.2 for property tests, `@vitest/coverage-v8` for coverage. See [[Testing pure code]].

## `core` exports its source, with no build step

- `packages/core` points `exports` at `./src/index.ts`. The web app (Vite) and the tests (Vitest) strip types themselves. The API will do the same when it's created.
- **Alternative:** compile `core` to `dist/*.js` + `.d.ts` files and point `exports` there. That's needed only when publishing to npm, and it means remembering to rebuild `core` before every change shows up in the apps.
- **Revisit when:** a consumer can't strip TypeScript (for example a published CLI on npm, v1.5).

## Node: 24 as the floor, 26 once it's LTS

- Node versions come in two kinds. **Even numbers** (22, 24, 26) become **LTS** ("long-term support") about six months after release: they get bug and security fixes for about three years. That's what servers should run. Odd numbers, and even ones before they turn LTS, are "Current": the newest features, a shorter support window.
- **Today:** Node 24 is LTS. Node 26 (what you run locally, 26.9.0) is not LTS yet; Node's schedule promotes it in late October 2026.
- **Node and the linter are unrelated.** Biome vs ESLint has no effect on which Node we can use.
- **Now:** `engines.node >= 24` means "24 or newer", so your Node 26 already works. `.node-version` says 24.
- **Next:** when 26 turns LTS, move `.node-version`, CI and the server image to 26 (tracked in the "later" list). The server and CI don't exist yet, so nothing is lost by waiting a few weeks.

## Status of A7

Settled 2026-10-11: Biome (as planned), TypeScript 7.0.2 (your call, instead of the plan's 6.0.x), and Node 24 as the floor, moving to 26 once it's LTS. Recorded in [[First-commit decisions]].

## Check yourself
- Why does `biome.json` ban `Date` only in `packages/core`, while the global `Temporal` is banned everywhere?
- What does `"packageManager": "pnpm@12.10.1"` protect against?
- What would you have to change if `core` had to be published to npm?
- Why should a server run an LTS version of Node rather than the newest one?
