# First-commit decisions

The choices that block the first line of code (`docs/brainstorm/00-overview.md` §2.A). For each: what was decided, why, and what we gave up.

## Answered 2026-10-09

### Phone: Android
A PWA (a website installed like an app) can do more on Android than on iPhone: push notifications without extra steps, receiving shared links and text from other apps (the "share target"), and long-press shortcuts on the app icon. The docs already assumed Android, so nothing changes.

What we gave up: nothing, for you. If an iPhone user ever matters, push and share work less well there, and a native app becomes more urgent.

### Address: `tasks.ahmedatif.in`
The app and its API live on **one** [[Origin]]: the web app at `/`, the API at `/api/v1`, login at `/api/auth`. There's no separate `api.` subdomain.

- **Why one origin:** the browser sends the login cookie automatically, with no CORS setup. (CORS is the browser's rule about which other sites may call your API.) Fewer moving parts.
- **Why the choice is close to permanent:** see [[Origin]]. The product *name* can still change; the address stays.
- **The alternative:** `plan.ahmedatif.in` was the suggested default, because the app does more than tasks (calendar, timer, attendance). But the address and the brand don't have to match, so this is cosmetic.

### Repo: public, MIT licence
- **Public:** recruiters and interviewers can read the code, and the reasoning in the vault shows up in commits and docs.
- **MIT:** anyone may reuse the code if they keep the copyright notice. Without any licence, public code is legally "all rights reserved".
- **The cost of public:** a leaked secret (an API key, a database password) is visible to everyone, and bots scan GitHub for them within minutes. So secrets live only in `.env` files that are never committed, and CI runs **gitleaks**, a scanner that fails the build if a secret slips into a commit.
- **Alternatives:** AGPL (anyone running a modified copy as a web service must publish their changes), or private.

### Server: Oracle Always Free, else a paid India VPS
A VPS is a rented virtual computer that runs all the time. Ours runs the API and Postgres.

- **The plan:** try Oracle Cloud's Always Free tier (Ampere A1: 2 CPUs, 12 GB RAM, ₹0) in the Hyderabad or Mumbai region for one evening. Free capacity is often "out of host capacity", so if it doesn't come through, pay about $10–12/month for a 2 GB VPS in India.
- **Why India:** every tap in the app makes a round trip to the server. Europe is 140–170 ms away; India is about 10–40 ms.
- **Why not serverless or free managed hosting:** the app needs an always-running process (reminders, the timer sweeper). Free tiers that "sleep", or bill per compute hour, break or get expensive with that. See `docs/brainstorm/07` §4.
- **Oracle gotchas,** for when we set it up: upgrade to Pay-As-You-Go with a ₹1 budget alert so idle machines aren't reclaimed, and open ports 80/443 in *both* Oracle's network rules and the server's own firewall.

## Settled later (2026-10-12 and 13)

| # | Decision | In one line |
|---|---|---|
| A6 | Google sign-in + an allowlist of your email | No email service needed; magic links break inside installed PWAs. You want to hand-build auth to learn it: that's the v1.5 machine tokens and device flow (D-061), written by hand |
| A7 | Biome; TypeScript 7.0.2; Node 24 as the floor, 26 once it's LTS | **Settled 2026-10-11.** See [[Tooling choices]] |
| A8 | Drizzle 0.45 + `pg` | Thin layer over SQL; migrations reviewed as SQL |
| A10 | Row-level security **in v0.2**, with the first data tables | Earlier than the plan's "before a second user". Built in v0.2: see [[Row-level security in our database]] and [[v0.2 contracts]] |
| A11 | `--no-ff` merges (never squash), CI on real Postgres (`services:`; locally `pnpm test` starts the Compose database), coverage gate on recurrence only | Readable history; strict tests where bugs are subtle |

## Check yourself
- Why does choosing `tasks.ahmedatif.in` matter more than choosing the app's name?
- What exactly goes wrong if the database password ends up in a public commit, even if you delete it in the next commit?
- Why does an always-running background process rule out free "sleeping" hosts?
