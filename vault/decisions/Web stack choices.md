# Web stack choices

The choices behind `apps/web` in v0.0 (the "Web" bullet of `docs/brainstorm/00-overview.md` §5, D-075, D-046, D-048). Versions were the latest stable on 2026-10-12 and are pinned exactly (no `^`). The module itself: [[Web app]]. Why an SPA and not Next.js at all: [[Why no Next.js]].

## Vite 8.3.4 (build tool and dev server)

- **What it does:** in development it serves your source files to the browser, rebuilding only what changed, so a save shows up in about a second. For production (`vite build`) it bundles everything into a few files in `dist/`. Vite 8 uses Rolldown, a bundler written in Rust.
- **Why:** the standard for React apps that don't use a framework. Plugins exist for everything we need (router, Tailwind, PWA).
- **Alternatives:** webpack (older, slower, much more config), Parcel (fine, smaller ecosystem), Next.js (a framework with a server; see [[Why no Next.js]]).

## React 19.3.0 with `@vitejs/plugin-react` 6.1.2

- **Why:** D-075. The most widely used UI library, so every problem has an answer online, and it's what Capacitor (a possible native wrapper later) expects.
- **Not used yet:** the React Compiler. Turn it on only if profiling shows slow re-renders.
- **Alternatives:** Svelte, Solid, Vue. All fine; fewer libraries for calendar-type UIs, and the plan is already written around React.

## TanStack Router 1.170.42, file-based routing

- **What it does:** maps URLs to screens and runs code before a screen draws (`beforeLoad`), which is how `/` redirects to `/login` with no flash. Every `<Link to=...>` is type-checked against the real routes. See [[Single-page apps and routing]].
- **File-based, not code-based.** Each route is a file in `src/routes/`; `@tanstack/router-plugin` 1.168.43 writes `src/routeTree.gen.ts` from them. With only two routes, code-based routing (one file listing both) would be shorter. File-based won because the plan (09 §5.2) grows to `calendar`, `tasks`, `settings` and more, and "one file per URL" stays easy to find. The cost: a generated file. It's **committed** (Biome ignores it) so `pnpm typecheck` works in a fresh clone; I checked that a fresh build regenerates it byte for byte.
- **Settings:** `addExtensions: true` so generated imports name `.tsx` files like the rest of the repo; `quoteStyle: 'single'`. `autoCodeSplitting` is off: two tiny screens don't need separate chunks. Turn it on when the calendar route makes the bundle heavy.
- **Alternative:** React Router 8 (more common, but its typed search params and loaders are weaker; 09 §5.1 compared them).

## TanStack Query 5.104.1 (not 5.104.2)

- **What it does:** keeps API answers in one cache, refetches them, and tells screens whether they're loading or failed. D-046: it's the **only** client cache of API data. See [[Server state and caching]].
- **Why 5.104.1:** the brief said 5.104.2, but it was published at 19:35 UTC on 2026-10-11, less than a day before install. pnpm 12 refuses packages younger than a day by default (`minimumReleaseAge`, a defence against a hijacked release that gets pulled within hours) and tried to add an exception to `pnpm-workspace.yaml`. I undid that and pinned 5.104.1 (2026-10-02). Bump it in a later chore commit.
- **Settings** (`src/lib/query-client.ts`):
  - `retry`: never for a 4xx (asking again gives the same answer), twice for network failures and 5xx.
  - `networkMode: 'always'`: run the request even when the browser claims to be offline. The default (`'online'`) *pauses* requests while offline; with no saved cache yet, that would mean a spinner forever instead of the offline screen. v0.2 did switch: now that the cache is saved to IndexedDB (D-046), reads use `'offlineFirst'` (try once, then pause until the network is back, showing the saved answer meanwhile), and writes keep `'always'` so a save fails fast offline instead of waiting in a queue ([[Offline and form choices]]).
- **Alternatives:** SWR (smaller, fewer features: no mutation queue, which D-046 needs in v0.3), plain `fetch` in `useEffect` (you'd rebuild caching, retries and race handling by hand), Redux Toolkit Query (heavier, tied to Redux).

## Tailwind CSS 4.3.3 via `@tailwindcss/vite`, no shadcn/ui yet

- **What it does:** utility classes (`rounded-lg px-4 py-2`) instead of separate CSS files. v4 needs no config file: `@import "tailwindcss"` in `src/index.css`, and it scans the source for the classes used.
- **Dark mode:** `dark:` classes follow the phone's setting (`prefers-color-scheme`), Tailwind's default. Checked in screenshots for both screens.
- **No `@apply`, no `@theme`:** Biome rejects Tailwind-only CSS syntax unless `biome.json` sets `css.parser.tailwindDirectives`, and `biome.json` is a root file outside this slice. So the page-wide classes sit on `<body>` in `index.html` and the CSS file is plain CSS. If you want `@theme` brand colours later, turn that Biome option on first.
- **shadcn/ui:** not yet. It copies ready-made components (dialogs, menus) into the repo; v0.0 has a button and two cards, so there's nothing to copy. It arrives with real components in v0.2.
- **Alternatives:** CSS Modules or plain CSS (more files, naming by hand), CSS-in-JS like styled-components (runtime cost, falling out of favour).

## Better Auth's React client 1.7.7

- **What it does:** `createAuthClient()` from `better-auth/react` knows Better Auth's routes, so sign-in is one call: `signIn.social({ provider: 'google', ... })`. No `baseURL`: it calls `/api/auth` on the page's own origin.
- **Why:** the API uses Better Auth (D-058), so its own client matches its routes and redirect behaviour exactly. Same version as the API.
- **Cost:** about 33 KB gzipped of the bundle, mostly code we don't use yet. Worth it for now; revisit if the bundle matters.
- **Alternative:** hand-written `fetch('/api/auth/sign-in/social', ...)` plus following the returned URL. Shorter, but you'd re-implement the redirect handling and keep it in step with Better Auth's changes.

## `vite-plugin-pwa` 2.0.0, `@vite-pwa/assets-generator` 2.0.0, `workbox-window` 7.4.1

- **What they do:** the plugin writes the web app manifest and a service worker at build time; the generator makes the PNG icons from one SVG; `workbox-window` is the small browser library that registers the service worker and notices updates. See [[PWAs and service workers]].
- **Pinned exactly** (D-075): 2.0.0 was nine days old. If it misbehaves, 1.3.0 is the fallback.
- **`generateSW`, not `injectManifest`.** `generateSW` writes the whole service worker from settings; `injectManifest` makes you write `src/sw.ts` yourself. 09 §5.8 plans `injectManifest` because push notifications and the share target need custom code. v0.0 has neither, so a generated one is less code to read. Switch when push arrives (v2).
- **`registerType: 'autoUpdate'`, not `'prompt'`.** 09 §5.8 wants a "Update ready, reload" toast, never reloading mid-gesture. v0.0 has no gestures or unsaved edits, and the demo is "merge a PR, open the app, see the new commit", so the new version takes over by itself. Switch to `'prompt'` when the calendar has drags and pending writes.
- **We register it ourselves** (`src/lib/pwa.ts`, `injectRegister: false`). Trap found while checking: the plugin only turns on `skipWaiting` and `clientsClaim` for `autoUpdate` when *it* injects the registration. With our own registration they were off, so a new version would wait until every window closed. Both are now set explicitly in `vite.config.ts`, and the built `sw.js` calls both.
- **Precache only the shell; no runtime caching of `/api`** (D-046, D-048). `navigateFallbackDenylist` keeps `/api/` and `/healthz` away from the cached page, so Google's redirect to `/api/auth/callback/google` reaches the API.
- **No service worker in `pnpm dev`** (`devOptions.enabled: false`): a cached shell during development makes edits look like they didn't apply. Use `build` + `preview` to test it.
- **Icons:** the `minimal2023Preset` (64/192/512, a maskable 512, a 180 Apple icon, `favicon.ico`), with the maskable and Apple icons on the logo's indigo instead of white, and 10% padding so the calendar stays inside Android's safe circle.
- **Alternative:** `@serwist/vite` (a maintained Workbox fork with the same model). Either works; `vite-plugin-pwa` has more documentation.

## Smaller calls

| Choice | Why | Alternative |
|---|---|---|
| Two tsconfigs (`tsconfig.json` for `src/`, `tsconfig.node.json` for config files) | Browser code gets DOM types and no `process`; config files get Node types and no DOM. `typecheck` runs both | One tsconfig with both type sets (lets `process.env` creep into browser code); project references with `tsc -b` (more moving parts) |
| `.ts` extensions in imports | Same style as `core` and the API, where Node requires them | Extensionless imports (fine for Vite, but two styles in one repo) |
| Tests in plain Node, no DOM library | Every test is a pure function (error parsing, messages, time formatting). `happy-dom`/`jsdom` would only slow them down | Component tests with Testing Library: when screens get logic worth testing |
| Display time with `Date` + `Intl`, not Temporal | Only formatting an instant in a zone; `Intl.DateTimeFormat` does that natively. Biome allows `Date` in apps. Temporal arrives with calendar maths | `temporal-polyfill` (21 KB gzipped for nothing extra here) |
| 12/24-hour from the user's locale | `Intl` with no locale uses the phone's language settings | Forcing `en-IN` or 24-hour |
| `API_PROXY_TARGET` falls back with `\|\|`, not `??` | An empty value counts as unset, like every other variable in `.env` | `??` (would treat `API_PROXY_TARGET=` with nothing after it as a target) |
| Theme colour `#4338ca` (indigo 700), background `#f8fafc` | The logo's tile; the light page background for the splash screen | |

## Bundle size (production build, 2026-10-12)

432 KB of JavaScript, about 141 KB gzipped: React, TanStack Router and Query about 103 KB, Better Auth's client about 33 KB, our code the rest. CSS 17.5 KB (4.5 KB gzipped). `@tasks/core` adds nothing: only `paths` is used, and the recurrence engine and its Temporal polyfill are tree-shaken away.

## Check yourself
- Why does `networkMode: 'always'` matter only because v0.0 has no saved cache? What would `'online'` do when you open the app on a train with no signal?
- The plan said `injectManifest` and `'prompt'`; v0.0 uses `generateSW` and `'autoUpdate'`. Name the feature that will force each switch.
- You delete `skipWaiting: true` from `vite.config.ts` and deploy. You open the installed app. Which version runs, and when does the new one take over?
- Why would committing a lockfile that pnpm's release-age check rejects be a problem for the next person who runs `pnpm install`?
