# 07 · Infra and Deployment

> Slice 07 of the parallel brainstorm. Written 2026-10-05.
> Pricing and free-tier limits were checked on **2026-10-05** using web search and vendor docs. Each figure says where it came from: **(vendor)** means the vendor's own docs or pricing page, and **(secondary)** means a third-party summary. Free tiers changed a lot in 2026: Hetzner raised prices twice, Oracle halved its Ampere allowance, DigitalOcean left the Student Pack, and AWS SES dropped its SES-specific free tier for new customers. Check again before paying for anything.

---

## 1. TL;DR

- **Run everything on one small VPS in an Indian region, using Docker Compose.** The box runs Caddy (TLS, reverse proxy, static PWA), the Node API, a separate worker process from the same image (jobs, shutdown reminders, session sweeper, Web Push), and Postgres 18. Put Cloudflare's free plan in front for DNS, the edge TLS certificate, static-asset caching, DDoS protection and one rate-limit rule.
- **Picking the box:** start on **Oracle Cloud Always Free** (Ampere A1, now 2 OCPU / 12 GB) with Hyderabad or Mumbai as the home region, *if* you can get capacity in one evening of trying. Otherwise use a **2 GB VPS in Mumbai, Bangalore or Delhi** (about $10–12/month). Hetzner is the best value per euro, but its EU regions are about 140–170 ms from India, and Hetzner Singapore now costs about €15.49/month for 2 GB with only 0.5 TB of traffic.
- **The design does not depend on the host.** The box is disposable: a bootstrap script, `compose.yaml`, encrypted secrets in git, and backups in Cloudflare R2 are enough to rebuild it anywhere in under two hours. A quarterly "evacuation drill" proves that.
- **The PWA calls the API on the same origin** (`tasks.ahmedatif.in/api`), so it needs no CORS, uses host-only `__Host-` cookies and makes no preflight round trips. Integrations (git hook, VS Code, Claude Code) use a separate host, `api.ahmedatif.in`, with bearer tokens only and no cookies.
- **Postgres is the only stateful service.** Jobs, rate-limit counters (single process for now) and reminders all live in Postgres or in process memory. No Redis until there is more than one API replica.
- **Backups:** at v0, a nightly `pg_dump` is encrypted with `age` and sent to R2, and a weekly automated restore drill restores it into the staging database. That way staging is yesterday's prod and every restore is tested. Before public signup, add WAL-G continuous archiving for point-in-time recovery, with `archive_timeout` set to 15 minutes, not 1.
- **CI/CD:** GitHub Actions runs lint, typecheck, unit tests, recurrence tests under three machine time zones, integration tests on a real Postgres 18, a migration lint (squawk), and an image build. `main` deploys to staging automatically. Production gets the *same image digest* through a manual promote step. Migrations are expand/contract only, with no down-migrations in prod. App rollback means redeploying the previous image tag. Data rollback means PITR to a named restore point that is created before each deploy.
- **Observability on a ₹0 budget:** Sentry (Student Pack: 50k errors for 1 year), UptimeRobot or Better Stack uptime and TLS checks, Healthchecks.io as a dead-man's switch for the worker, backups and restore drills, and ntfy push alerts to the phone. Logs stay on the box, with rotation, until about 1k users.
- **Cost:** about $0–6/month at 1 user, about $0–15 at 1k users, and about $45–100 at 10k users if self-hosted. **Compute is never the first free tier to break.** The order is: Resend's 100 emails/day cap (a single launch-day spike), then Sentry's 5k errors/month (one noisy bug), then R2's 10 GB (backup retention or a misconfigured WAL archive), then stored voice audio if slice 11 keeps it.
- **Deliberately not doing:** Kubernetes, multi-region, Terraform for one VPS, Redis "just in case", a self-hosted Prometheus/Grafana/Loki stack on a small box, per-PR full-stack preview environments, or zero-downtime blue/green before there are users. Caddy's `lb_try_duration` hides the few-second restart blip.

---

## 2. Assumptions about other slices

Every one of these assumptions changes the plan if it turns out wrong. A critic should check each one against the matching slice.

| # | Assumption | Slice | If wrong |
|---|---|---|---|
| A1 | The backend is a **Node.js/TypeScript modular monolith** (Fastify or Hono). It has two entrypoints from one codebase: `server` (HTTP) and `worker` (jobs, schedules). API processes are stateless. | 03 | Another runtime (Go, Bun, Deno) only changes the Dockerfile. A microservice split changes the topology a lot, and I'd argue against it. |
| A2 | **PostgreSQL** is the single source of truth. I target **Postgres 18**: 19 was still in beta/RC on 2026-10-05, with GA expected in October. Migrations are plain SQL files run by a migration tool (dbmate, node-pg-migrate, Drizzle Kit or similar). | 04 | If 04 picks SQLite or per-user databases, approach C (§3) becomes the natural fit and the backup design changes to Litestream or Durable Object storage. |
| A3 | **D-009 heartbeats are `UPDATE ... SET last_seen`** on a session row, every ~2 min per active integration user. `last_seen` is **not indexed**, so updates stay HOT (heap-only tuple) and don't bloat indexes. | 04/05 | If `last_seen` is indexed, expect index bloat and much more WAL. That affects PITR storage cost (§5.13). |
| A4 | Background jobs use a **Postgres-backed queue** (pg-boss or graphile-worker) in a **long-running worker process**. Cron-like schedules (reminder dispatcher every minute, session sweeper every 5 minutes) run in that worker. Lazy session closing (D-009) is computed on read *and* finalised by the sweeper. | 05 | If 05 assumes Redis/BullMQ, add a Valkey container (~30 MB RAM). That's fine, but it's a second stateful thing to back up and monitor. |
| A5 | Realtime (timer sync across devices) uses **SSE or WebSocket from the API process**. With one API replica no broker is needed. With more than one, Postgres `LISTEN/NOTIFY` fans out. | 05 | Infra impact: Cloudflare proxies cut idle connections at about 100 s, so the server must send a heartbeat comment or ping every ~30 s. |
| A6 | **Auth:** magic-link email (passkeys maybe later). The PWA gets an httpOnly session cookie. Integrations get scoped, hashed-at-rest personal access tokens with a recognisable prefix (e.g. `plnr_`). Shared `*.ahmedatif.in` identity is far future and would use redirects to an `accounts.` host, not a `Domain=.ahmedatif.in` cookie. | 06 | Password auth removes most of the email volume. A parent-domain cookie raises cookie-tossing risks (§5.10). |
| A7 | Integrations (git hook, VS Code, Claude Code hooks) call `api.ahmedatif.in` over HTTPS with bearer tokens. Commit events are idempotent on commit SHA. Clients queue locally and retry with backoff when they get a 429 or 5xx. | 08 | Without client-side queueing, a deploy blip loses commit events. |
| A8 | The frontend is a **static SPA/PWA build** (Vite + React or similar) with a service worker, and no SSR. | 09 | If 09 picks Next.js SSR, the `web` container becomes a Node server rather than static files behind Caddy. Same box, about 150 MB more RAM. |
| A9 | Voice capture **transcribes on-device** (Web Speech API or similar), and raw audio is either not stored or kept for a short time (≤30 days). | 11 | If every voice note is stored forever, audio storage is the biggest cost line by far at 10k users (§5.16). |
| A10 | The shutdown reminder fires at a **user-chosen local time** (default around 21:00 IST). It is a Web Push notification, with in-app fallback. | 12/10 | Several reminder types per day only change push volume, which is free anyway. |
| A11 | The recurrence engine (01/10) is a **pure TypeScript package** with deterministic unit tests and property-based tests (fast-check), runnable in CI without a database. | 01/10 | If recurrence expansion lives in SQL, CI needs Postgres for those tests too. That's fine, just slower. |
| A12 | The repo is a **pnpm workspace monorepo**: `apps/api`, `apps/web`, `packages/*`, `infra/`. | 13 | Only paths in the snippets change. |

---

## 3. Three genuinely different approaches

| | **A. One boring box** (single VPS + Docker Compose, Cloudflare in front) | **B. PaaS + managed Postgres** (Fly.io / Railway / Render in Singapore + Neon or Supabase) | **C. Edge serverless** (Cloudflare Workers + Durable Objects/D1 + Cron/alarms) |
|---|---|---|---|
| **Pros** | Cheapest predictable bill ($0 on Oracle Always Free, about $10–12 for a 2 GB India VPS). Can sit *in India* (~5–40 ms to Indian cities vs 138–172 ms to Hetzner Germany (secondary benchmark)). The long-running worker, schedules, SSE and Web Push all just work. One mental model. Every layer can be explained. Fully portable. | No OS to patch. Managed backups/PITR (Neon free keeps 6 h of history, Launch 7 days). Easy deploys and rollbacks. Neon branching gives per-PR databases. Logs and metrics are built in. | Effectively free at 1–1k users (100k requests/day free). Global edge with Indian PoPs. No servers. Durable Object alarms are a lovely primitive for per-user reminders and lazy session closing. Scales without thinking. |
| **Cons** | You are the SRE and the DBA: patching, disk, backups, Postgres upgrades. A single point of failure (accepted, with an SLO). Oracle free capacity can vanish (reclaim policy, quiet limit changes). Deploys have a few-second blip unless engineered away. | **No Indian region** for most options. Fly deprecated Mumbai (`bom`); Neon has Singapore but not Mumbai. **Always-on worker breaks scale-to-zero:** 0.25 CU × 730 h = 182.5 CU-h vs Neon free's 100 CU-h. Fly has no free tier for new orgs. Render's free tier sleeps after 15 min, has no workers/cron, and deletes free Postgres after 30 days. Supabase free pauses after 7 days of low activity, and `*.supabase.co` was DNS-blocked in India for ~7–8 days in Feb 2026. Realistically $10–30/month from day one. | Different runtime and data model: D1 is SQLite with a **10 GB hard cap per database** (vendor). The natural design is one Durable Object (with its own SQLite) per user, which conflicts with assumption A2 (Postgres). The free plan gives 10 ms CPU per invocation and 5 cron triggers. Lock-in to Cloudflare semantics. Local dev and testing differ from prod. Postgres via Hyperdrive still needs a DB somewhere else. |
| **Solo-dev effort** | Medium up front (1–2 weekends for box, compose, CI deploy, backups), then low. About 1–2 h/month of upkeep if automated. | Low up front (hours), low upkeep, but you fight around free-tier sleep and the cost of an always-on worker. | Medium–high: learn DO/alarms/D1 semantics and re-think the data model (04) and recurrence queries. Low upkeep afterwards. |
| **Interview value** | **High and explainable:** "I run Postgres with WAL archiving to R2, I create a named restore point before each migration, and a weekly job restores last night's backup into staging and asserts on it." Very few students can say that. | Medium: easy to demo, but much of the story is "the platform did it". Branch-per-PR databases are a nice talking point. | High novelty (actor-per-user design), but it is Cloudflare-specific knowledge, and it would force every other slice to redesign around it. |

**What each approach optimises for.** Approach A optimises for *understanding and cost*. You own every moving part, so you can explain every moving part, and the bill is close to zero. Its weakness is that reliability is your job. That is fine at 1 user and acceptable at 1k with drills and alerts, and it needs a second box (or a managed DB) at roughly 10k. Approach B optimises for *time-to-first-deploy and not being the DBA*. Its weakness for this product is specific, not generic: the product needs an always-on worker (shutdown reminders, session sweeper, push), and that one requirement turns every scale-to-zero free tier into a paid one. It also puts the database 50–90 ms away in Singapore instead of in India. Approach C optimises for *operational nothingness at any scale*, and is actually the cheapest at 10k users. But it isn't a hosting choice you can make alone: it dictates the data model (SQLite per user or D1's 10 GB cap), the job model (alarms) and the realtime model (DO WebSockets). Slices 03–05 would all have to agree to it, and the Postgres assumption they are probably converging on would be thrown away.

One India-specific lesson cuts across all three. **Never put a third-party hostname in a client.** In February 2026 Indian ISPs DNS-blocked `*.supabase.co` for about a week under a Section 69A order, and apps that called Supabase directly broke. If the PWA, git hook and VS Code extension only ever talk to `*.ahmedatif.in`, any provider can be swapped by changing one DNS record or one origin.

---

## 4. Recommendation

**Approach A: one India-region VPS running Docker Compose behind Cloudflare, with Postgres on the box and encrypted backups to Cloudflare R2.** Concretely:

1. **Host:** Oracle Cloud Always Free, Ampere A1 at 2 OCPU / 12 GB, 200 GB block storage, home region Hyderabad or Mumbai. Upgrade the account to Pay-As-You-Go (PAYG) with a budget alert so it isn't subject to the free-only idle-reclaim policy, and stay inside Always Free limits. **Fallback:** a 2 GB VPS in Mumbai, Bangalore or Delhi (Vultr, DigitalOcean, Lightsail; about $10–12/month). The fallback is not a downgrade in design, just in price. If Oracle reclaims or changes terms again, the evacuation runbook moves you in under two hours.
2. **Edge:** Cloudflare free plan (DNS, proxied records, Full (strict) TLS, cache, 1 rate-limit rule, Turnstile later). Origin TLS by Caddy + Let's Encrypt, so you can grey-cloud around Cloudflare if you ever have to.
3. **Topology:** same-origin `/api` for the PWA, and `api.ahmedatif.in` for token clients. Postgres-backed jobs. No Redis.
4. **Pipeline:** GitHub Actions → GHCR images tagged by SHA → staging auto-deploy → manual promote of the same digest to prod. Expand/contract migrations, linted by squawk.
5. **Safety net:** nightly encrypted dumps → R2, a weekly restore drill into staging, a quarterly evacuation drill, WAL-G PITR before public signup. Sentry, uptime checks, a Healthchecks.io dead-man's switch and ntfy alerts.

### The strongest argument against it (steelman)

"You are volunteering to be a part-time SRE and DBA while your actual product risk is the recurrence engine. Every hour spent on Oracle's console, iptables rules in the Ubuntu image, ARM builds, disk alerts, WAL archiving and Postgres major upgrades is an hour not spent on 'this and following' edits and DST. A managed Postgres gives PITR, minor upgrades and a restore button as checkboxes. A PaaS gives deploys, rollbacks, TLS and logs as defaults. Even at $15–30/month, that is a rounding error next to a student's weekends. The single box also violates the one rule everyone agrees on: don't run the database on the same machine as the app. And 'free Oracle VM' signals hobbyist to some interviewers, while 'Neon branch per PR, Fly machines in Singapore' signals modern practice. Finally, Oracle quietly halved its free Ampere allowance in mid-2026 with no announcement. Building production on a gift that can be taken back is the opposite of production-grade."

That argument is genuinely strong. My answer: (1) the ops work in A is front-loaded and *scripted once* (bootstrap, deploy, backup and restore scripts). After that it's about 1–2 h/month, and the drills are themselves the interview story. (2) The product needs an always-on worker, which makes B cost money every month for zero users. (3) An Indian region matters for a PWA whose every sync and timer action round-trips to the API. (4) The Oracle risk is bounded by design: the box holds nothing that isn't in git or R2.

### When I'd switch

- **Move the database to managed Postgres first** (keeping app + worker on the box) if any of these happen: upkeep goes over ~2 h/month for two months in a row (log it in JOURNEY), a restore drill fails twice, the DB passes ~20 GB, or real users depend on it and a single-disk failure would lose more than your RPO. That move is one `DATABASE_URL` change plus a dump/restore. It's the cheapest partial switch. Supabase has a Mumbai region but needs a custom domain or proxy to avoid the 2026-style DNS-block risk. Neon is Singapore-only.
- **Move compute to a PaaS** only if Oracle capacity disappears *and* you'd rather pay than evacuate to another VPS.
- **Approach C** only if slices 03/04 independently choose a per-user SQLite model. Infra should not force that decision.

---

## 5. Implementation walkthrough

### 5.1 Topology

```mermaid
flowchart LR
    PWA["PWA (browser or installed)"] -->|"HTTPS tasks.ahmedatif.in"| CF["Cloudflare edge: DNS, TLS, cache, rate rule"]
    INT["git hook / VS Code / Claude Code"] -->|"HTTPS api.ahmedatif.in, bearer token"| CF
    CF -->|"origin TLS, firewall allows only Cloudflare IPs"| CADDY
    subgraph BOX["Single VPS, India region, Docker Compose"]
        CADDY["Caddy: static PWA, reverse proxy"] --> API["api: Node server"]
        API --> DB[("Postgres 18")]
        WORKER["worker: jobs, reminders, sweeper"] --> DB
    end
    WORKER -->|"Web Push (VAPID)"| PUSH["FCM / Mozilla / Apple push services"]
    API -->|"magic links"| MAIL["Resend, later SES or ZeptoMail"]
    DB -. "nightly encrypted dump, later WAL" .-> R2[("Cloudflare R2: backups")]
    API -. "errors" .-> SENTRY["Sentry"]
    WORKER -. "dead-man ping every minute" .-> HC["Healthchecks.io"]
    UP["UptimeRobot / Better Stack"] -. "HTTP + TLS checks" .-> CF
    HC -->|"alert"| PHONE["ntfy app on phone"]
    UP -->|"alert"| PHONE
```

Three processes do real work: `api`, `worker` and `db`. Caddy is plumbing. Everything a new machine needs is in the repo (`infra/`), in R2 (data), or in your password manager (one `age` private key and the Cloudflare/R2 credentials).

### 5.2 Picking the box (verified 2026-10-05)

| Option | Specs / price | Latency from India | Verdict |
|---|---|---|---|
| **Oracle Always Free, Ampere A1** (Mumbai `ap-mumbai-1` / Hyderabad `ap-hyderabad-1`) | **2 OCPU / 12 GB** total across the tenancy since mid-2026 (was 4/24). 1,500 OCPU-h and 9,000 GB-h a month. $0. Free-only accounts: an instance is "idle" and reclaimable if, over 7 days, p95 CPU, network *and* memory are all under 20%. PAYG accounts reportedly keep the older allowance per support emails, but Oracle's docs aren't updated (secondary: InfoQ, Jul 2026). | In-country (~5–40 ms) | **Default** if you get capacity. Plenty of RAM for prod + staging + WAL-G. ARM64, so build arm64 images. |
| **India 2 GB VPS**: Vultr / DigitalOcean BLR1 / AWS Lightsail Mumbai | Vultr regular 1 GB $5, 2 GB about $10. DO 1 GB $6, 2 GB $12. Lightsail 2 GB $12 with IPv4, and Mumbai bundles include **half** the listed transfer (1.5 TB) (all secondary; check the regional price at checkout). | In-country | **Fallback / paid default.** Note: **DigitalOcean left the GitHub Student Pack.** All Pack credits expired 2026-08-01 (secondary, multiple sources). |
| **Hetzner EU CX23** | 2 vCPU / 4 GB / 40 GB. €5.49/month after the 15 June 2026 adjustment (was €3.99) **(vendor)**. 20 TB traffic. | 138–172 ms (secondary benchmark) | Best value per euro, but far. OK only if a strongly local-first frontend hides latency. |
| **Hetzner Singapore** | No CX/CAX listed. CPX12 €15.49, CPX22 €26.49 **(vendor)**. Only **0.5 TB** traffic, €7.40/TB overage. No Object Storage in SIN (secondary). | ~50–90 ms from East India (unverified) | Poor value now. |
| **Azure for Students** | $100 credit for 12 months + B1s (1 vCPU / 1 GiB) 750 h/month for 12 months (secondary). Central India region. | In-country | 1 GiB is too tight for Postgres + Node + Caddy without swap pain, and there's a 12-month cliff. Better used as an emergency evacuation target than as home. |

**Oracle-specific setup notes** (these eat evenings if you don't know them): the Ubuntu images ship with iptables rules that block everything except SSH, *in addition to* the VCN security list. Open 80/443 in both. Pick the home region at signup, because Always Free resources only exist there. If A1 says "out of host capacity", retry over a day or two, or try a different availability-domain/fault-domain combination. Don't write a retry bot that hammers the API. Set a budget alert at ₹1 on the PAYG account.

### 5.3 Services and verified pricing (checked 2026-10-05)

| Need | Choice | Free tier / price | Source |
|---|---|---|---|
| DNS, edge TLS, CDN, DDoS | Cloudflare Free | Free. **1** rate-limiting rule (IP-keyed, 10 s window), **5** custom WAF rules. Universal SSL covers apex + **first-level** subdomains only (deeper names need Advanced Certificate Manager at $10/month). | secondary (WAF), Cloudflare docs + community (SSL) |
| Backups object store | Cloudflare R2 | 10 GB-month free, 1M Class A, 10M Class B ops, **free egress**. $0.015/GB-month after. Lifecycle rules for retention. | vendor |
| Second backup copy (optional) | Backblaze B2 | First 10 GB free. $6.95/TB-month. Egress free up to 3× stored. | secondary |
| Transactional email | Resend (start) → Amazon SES or Zoho ZeptoMail | Resend: 3,000/month **and 100/day**, 1 domain, sending pauses at the cap. SES: $0.10 per 1,000 (Mumbai); the SES-specific free tier ended for new customers on 2026-07-21. ZeptoMail: $2.50 per 10k-email credit (credits valid 6 months), 10k free on signup, INR billing. Postmark free 100/month. Brevo free 300/day. | secondary |
| Error tracking | Sentry | Developer (free): 5k errors/month, 1 user. **Student Pack: 50k errors, 100k transactions, Team features, 1 year.** | vendor (Pack page), secondary (free plan) |
| Uptime + TLS expiry | UptimeRobot or Better Stack | UptimeRobot: 50 monitors, 5-min checks (commercial use allowed under fair use). Better Stack: 10 monitors + heartbeats, 3-min checks, 1 status page. | secondary |
| Cron / dead-man monitoring | Healthchecks.io | Hobbyist: 20 checks free, ntfy integration. | secondary |
| Phone alerts | ntfy (ntfy.sh or self-hosted) | Free. Topics are public by name, so use a long random topic name. | — |
| Logs/metrics (later) | Grafana Cloud | Free: 10k active series, 50 GB logs, 14-day retention. | secondary |
| CI | GitHub Actions | Public repos: free and unmetered on standard runners (incl. `ubuntu-24.04-arm`). Private: 2,000 min/month free (Pro via the Student Pack: 3,000). Linux $0.006/min since 2026-01-01. The proposed self-hosted runner fee was shelved. | secondary |
| Container registry | GHCR | Free for public images. | — |
| Secrets | SOPS + age (in repo) | Free. Doppler Team is free while a student (Pack), if you prefer SaaS. | vendor (Pack page) |
| Web Push | VAPID to browser push services | Free. No per-message cost. | — |
| Bot/abuse | Cloudflare Turnstile | Free. | — |

### 5.4 Environments and seed data

| Env | Where | Data | Deploy trigger | Purpose |
|---|---|---|---|---|
| **local** | Laptop: `docker compose -f infra/compose.dev.yaml up` (Postgres 18 + Mailpit), app via `pnpm dev` | Deterministic seed | — | Day-to-day dev. Mailpit captures magic-link emails at `localhost:8025`. |
| **CI** | GitHub Actions service container `postgres:18` | Migrations + seed on an empty DB | Every PR / push | Proves migrations apply from zero and the seed still works. |
| **staging** | **Same box**, separate compose project (`planner-staging`), separate database `planner_staging` and role in the same Postgres cluster, hosts `tasks-staging.ahmedatif.in` and `api-staging.ahmedatif.in` | **Restored from last night's prod backup** by the weekly drill, then scrubbed (see below) | Every merge to `main` | Test migrations against real-shaped data before prod. |
| **production** | Same box, `planner-prod` | Real | Manual promote of an image already running in staging | — |
| **previews** | *Not at first.* Later: Cloudflare Pages preview of `apps/web` only, with a 10-line Pages Function proxying `/api/*` to staging so it stays same-origin | Staging | Per PR | Only worth it once someone else reviews UI. |

Note the hostnames: `tasks-staging.ahmedatif.in`, **not** `staging.tasks.ahmedatif.in`. A second-level subdomain isn't covered by Cloudflare's free Universal SSL certificate and would fail TLS at the edge.

**Staging is yesterday's prod.** The weekly restore drill (§5.13) restores the newest backup into `planner_staging`. This proves the backup is restorable *and* gives staging realistic data, including the weird recurrence exceptions you actually created. Once anyone other than you has an account, a scrub script runs right after restore and before staging starts:

```sql
-- infra/sql/scrub-staging.sql  (runs inside planner_staging only)
DELETE FROM push_subscriptions;            -- staging must never push to real phones
DELETE FROM integration_tokens;            -- real tokens must not work against staging
UPDATE users SET email = 'user' || id || '@example.test' WHERE email NOT LIKE '%@ahmedatif.in';
DELETE FROM auth_sessions;                 -- force re-login
```

Staging also runs with `EMAIL_MODE=log` and `PUSH_MODE=log`, so even an unscrubbed row can't reach a real person. Belt and braces.

**Seed data** (`pnpm db:seed`) is deterministic: fixed faker seed, fixed "now" via `FAKE_NOW`. It creates one user, a "Classes" group shaped like a KIIT timetable (Mon/Wed 10–14, Tue 15–17, Thu/Fri 9–14), a daily "Run" block at 18:00 IST, a "Writing" group, two cancelled classes (one "prof cancelled", one "I skipped"), two projects with nested tasks, two weeks of past sessions with commit refs, and ten thought-dump items of different ages. It is also the fixture for e2e tests. `FAKE_NOW` lets you test the 21:00 IST shutdown reminder and the IST/UTC date boundary (00:00–05:30 IST is the previous UTC date) without waiting.

### 5.5 Secrets management

- **Inventory:** `DATABASE_URL`, session/cookie signing key, token-hash pepper (if 06 uses one), **VAPID key pair**, email API key, Sentry DSN, R2 access key + secret (scoped to the backup bucket only), Healthchecks ping URLs, ntfy topic, backup `age` **public** key. The backup `age` **private** key never lives in the repo.
- **Local:** `.env` (gitignored), validated at boot with a zod schema so the process exits immediately with a clear message if anything is missing. `.env.example` is committed with every key and a comment.
- **CI:** GitHub environment secrets (`staging`, `production`). CI only needs the SSH deploy key, the Sentry auth token for source maps, and nothing app-level.
- **Server:** `infra/secrets/prod.env.sops` and `staging.env.sops` are committed **encrypted** with SOPS + age to two recipients: the server's age key and your personal age key. `deploy.sh` runs `sops -d` into a `0600` `.env` owned by the `deploy` user. Why SOPS rather than hand-edited `.env`: recovery after losing the box becomes "clone repo + one key from the password manager", and secret changes show up as reviewable diffs of key names.
- **Never rotate VAPID keys casually.** Every push subscription is bound to the VAPID public key, so rotating it silently orphans every subscribed device. Treat it like a database: back it up in the password manager, and rotate only with a plan to re-subscribe clients.
- `gitleaks` runs in CI and as a pre-commit hook.

### 5.6 Repo layout for infra

```
infra/
  bootstrap.sh            # idempotent: user, ssh, docker, chrony, swap, unattended-upgrades, timers
  compose.yaml            # prod + staging (project name & env differ)
  compose.dev.yaml        # local: postgres:18 + mailpit
  Caddyfile
  secrets/{prod,staging}.env.sops
  bin/{deploy.sh,backup.sh,restore-drill.sh,check-disk.sh,check-origin-cert.sh}
  systemd/{planner-backup,planner-restore-drill,planner-checks}.{service,timer}
  sql/scrub-staging.sql
  RUNBOOK.md              # evacuation, restore-to-time, rotate-secret, revoke-token
```

There's no Terraform. For one VPS, an idempotent `bootstrap.sh` plus provider firewall rules written in `RUNBOOK.md` *is* the infrastructure as code, and the evacuation drill proves it works.

### 5.7 Container images

One Dockerfile with two targets: `api` (also used for `worker` and `migrate`, with a different command) and `web` (Caddy with the built PWA baked in). Same Git SHA tags both, so the frontend and backend are always deployed as a matched pair.

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-slim AS base            # Node 24 LTS; move to 26 once it enters LTS (late Oct 2026)
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ packages/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
ARG GIT_SHA=dev
ENV VITE_RELEASE=$GIT_SHA
RUN pnpm -r build
# produce a pruned prod-only copy of the api package (check `pnpm deploy` flags for your pnpm major)
RUN pnpm --filter=api deploy --prod /out/api

FROM node:24-slim AS api
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build /out/api ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM caddy:2 AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/www
```

`TZ=UTC` everywhere is deliberate. The server never assumes IST. User time zones are data (assumptions A10/A11), and the recurrence tests run under several machine time zones to catch accidental local-time use (§5.12).

### 5.8 Compose

```yaml
# infra/compose.yaml — used for both prod and staging, run from /srv/planner/<env>/
# (each dir has its own .env with COMPOSE_PROJECT_NAME, GH_OWNER, IMAGE_TAG and app secrets).
# Prod runs all services; staging runs only api + worker (see note below).
x-app: &app
  image: ghcr.io/${GH_OWNER}/planner-api:${IMAGE_TAG}
  env_file: .env
  restart: unless-stopped
  depends_on:
    db: { condition: service_healthy }

services:
  web:                                  # Caddy: TLS, static PWA, reverse proxy (prod project owns ports)
    image: ghcr.io/${GH_OWNER}/planner-web:${IMAGE_TAG}
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: [caddy_data:/data, caddy_config:/config]

  api:
    <<: *app
    command: ["node", "dist/server.js"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 15s

  worker:
    <<: *app
    command: ["node", "dist/worker.js"]
    stop_grace_period: 30s              # let in-flight jobs finish; pg-boss/graphile re-queue the rest

  db:
    image: postgres:18                  # later: custom image FROM postgres:18 + wal-g binary
    restart: unless-stopped
    env_file: .env.db
    shm_size: 256mb
    stop_grace_period: 60s              # clean shutdown, no crash recovery on every deploy
    volumes:
      - pgdata:/var/lib/postgresql      # postgres:18 moved PGDATA to /var/lib/postgresql/18/docker;
                                        # mount the PARENT dir (the old .../data mount stops PG18 starting)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
      interval: 5s
      retries: 10
    # NO `ports:` — Postgres is reachable only on the compose network.

volumes: { pgdata: {}, caddy_data: {}, caddy_config: {} }
```

The staging project runs only `api` and `worker`, pointing at the `planner_staging` database on the prod cluster through an external network. The prod Caddy routes the staging hostnames to `planner-staging-api-1:3000`. That's one Caddy and one Postgres, which keeps a 2 GB fallback box viable.

Host-level settings in `bootstrap.sh`:

- `/etc/docker/daemon.json` → `{"log-driver": "local"}`. The `local` driver rotates by default, whereas `json-file` grows forever until the disk fills.
- 2 GB swap file on boxes with ≤4 GB RAM.
- `chrony` for NTP.
- `unattended-upgrades` for security patches, with automatic reboot at 04:00 IST (22:30 UTC).
- The SSH daemon is key-only with no root login.
- The provider firewall (Oracle security list / VPS firewall) allows 80/443 **only from Cloudflare's published IP ranges** and 22 from anywhere (key-only), or from Tailscale only if you adopt it. Use the *provider* firewall, not ufw: Docker's published ports bypass ufw rules.

### 5.9 Caddy and Cloudflare edge config

```caddyfile
{
    email ops@ahmedatif.in
    servers {
        # Real client IPs: without this, every request appears to come from Cloudflare
        # and per-IP rate limiting throttles everyone at once.
        trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
        client_ip_headers CF-Connecting-IP
    }
}

(common) {
    encode zstd gzip
    header Strict-Transport-Security "max-age=31536000"
    header -Server
}

tasks.ahmedatif.in {
    import common
    handle /api/* {
        reverse_proxy api:3000 {
            lb_try_duration 10s      # during a restart, hold and retry instead of returning 502
            lb_try_interval 250ms
        }
    }
    @nocache path /sw.js /index.html /manifest.webmanifest
    header @nocache Cache-Control "no-cache"
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    handle {
        root * /srv/www
        try_files {path} /index.html
        file_server
    }
}

api.ahmedatif.in {
    import common
    reverse_proxy api:3000 {
        lb_try_duration 10s
    }
}

tasks-staging.ahmedatif.in, api-staging.ahmedatif.in {
    import common
    header X-Robots-Tag "noindex"
    # same shape as above, upstream planner-staging-api-1:3000, static from /srv/www-staging
}
```

(Refresh the Cloudflare IP list from `cloudflare.com/ips` once a quarter. It rarely changes.)

**Cloudflare zone settings:**

- SSL/TLS mode **Full (strict)**. Never "Flexible", which sends plaintext to the origin and causes redirect loops with Caddy.
- "Always Use HTTPS" on. Minimum TLS 1.2.
- **Bot Fight Mode off.** On the free plan it can't be skipped per path, and it would JS-challenge the git hook and the VS Code extension, which can't solve challenges.
- One rate-limiting rule: `/api/auth/*` at 20 requests per 10 s per IP → block for 10 s. A coarse backstop; the real limits are in the app.
- No cache rules needed: Cloudflare caches by file extension by default, respects the `no-cache` on `sw.js`, and doesn't cache JSON API paths.

### 5.10 Domain, DNS, TLS, HSTS, cookies and email DNS

**DNS (Cloudflare nameservers for `ahmedatif.in`):**

| Name | Type | Value | Proxy | Notes |
|---|---|---|---|---|
| `tasks` | A / AAAA | VPS IP | Proxied | PWA + same-origin `/api` |
| `api` | A / AAAA | VPS IP | Proxied | Integrations, bearer tokens only |
| `tasks-staging`, `api-staging` | A / AAAA | VPS IP | Proxied | First-level names only (Universal SSL) |
| `status` | CNAME | uptime provider's status page | DNS only | Optional |
| `mail` subdomain records | TXT/MX/CNAME | from the email provider (SPF on the bounce subdomain, DKIM key, MX for bounces) | DNS only | Transactional mail sends **from `mail.ahmedatif.in`**, keeping its reputation separate from any personal use of the apex |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@ahmedatif.in; adkim=s; aspf=s` | — | Move to `p=quarantine` after 2–4 weeks of clean reports |
| apex MX | MX | Cloudflare Email Routing | — | Free inbound forwarding of `dmarc@`, `ops@`, `security@` to Gmail |
| `ahmedatif.in` | CAA | `0 issue "letsencrypt.org"` | — | Optional. Cloudflare adds its own CAs automatically while Universal SSL is on |

Because the records are proxied, evacuating to a new box is instant: change the origin IP in Cloudflare and clients never see a DNS TTL.

**TLS:** two certificates. Cloudflare's edge certificate (automatic) and Caddy's Let's Encrypt certificate at the origin (automatic over HTTP-01, which works behind the proxy since Let's Encrypt follows the HTTPS redirect). If HTTP-01 ever fails, switch Caddy to DNS-01 with a scoped Cloudflare API token. I deliberately don't use a Cloudflare Origin CA certificate or a Tunnel. Both are simpler, but both make Cloudflare mandatory, and the only reason to own an origin certificate is so you *can* grey-cloud around Cloudflare. In India that has real value: if an ISP misroutes or blocks a Cloudflare range, you can still serve. Let's Encrypt is shortening lifetimes (opt-in 45-day profile since 2026-05-13, default 64 days from 2027-02-10, 45 days from 2028-02-16), and it stopped sending expiry reminder emails in 2025. Caddy renews automatically, but *you* must monitor expiry (§5.14).

**HSTS:** `max-age=31536000` on `tasks.` and `api.` only. No `includeSubDomains` on the apex and **no preload** for now. Preload is effectively irreversible, and you'll want throwaway HTTP experiments on other `*.ahmedatif.in` names someday. `.in` is not an HTTPS-only TLD the way `.dev`/`.app` are, so HSTS on each host is what enforces it. PWAs need a secure context anyway: service workers and push don't run over plain HTTP, except on `localhost`.

**Cookies:** host-only `__Host-session; Secure; HttpOnly; SameSite=Lax; Path=/` on `tasks.ahmedatif.in`, with no `Domain` attribute. `api.ahmedatif.in` **refuses cookie auth entirely**, which makes it immune to CSRF by construction. For the far-future shared identity across `*.ahmedatif.in`, don't widen the cookie to `Domain=ahmedatif.in`. Any subdomain you ever point at a third-party host (a blog platform, a Vercel experiment) could then read or overwrite ("toss") it. Use an `accounts.` host with redirect-based login instead (an assumption handed to 06).

### 5.11 Background jobs, reminders and Web Push on this topology

- **Worker loop:** a scheduler in the worker runs every minute. It selects users whose reminder local-time falls in the current minute (computed in each user's tz), inserts `reminder_sends(user_id, local_date, kind)` with a **unique constraint**, and enqueues push jobs only for rows that were actually inserted. Restarts and double-ticks therefore can't double-send. **Catch-up policy:** if the worker was down at 21:00 and comes back at 21:40, send late reminders up to 2 h late, otherwise skip. Nobody wants a shutdown reminder at 3 am.
- **Session sweeper** (D-009): every 5 minutes it finalises sessions where `last_seen + gap_threshold < now()`. Reads still compute closure lazily, so a dead sweeper degrades reports, not correctness.
- **Dead-man's switch:** each successful scheduler tick pings a Healthchecks.io check (period 1 min, grace 5 min). If the worker hangs, OOMs or is stuck in a crash loop, your phone buzzes within ~6 minutes. Without this, "reminders silently stopped" is the most likely production failure of this app and the hardest to notice.
- **Web Push:** the `web-push` library with VAPID keys from secrets. Delete subscriptions on `404`/`410` responses. Back off on `429`. iOS only delivers push to a PWA **installed to the Home Screen** (iOS 16.4+), and the permission prompt must come from a user tap. That's a UX requirement for 09/12, but infra should know that "push not received" on iOS is often "not installed".
- **Realtime connections** (A5): Cloudflare closes proxied connections that are idle for about 100 s. Send an SSE comment or WebSocket ping every 30 s.

### 5.12 CI/CD

```mermaid
flowchart LR
    PR["Pull request"] --> CI["ci.yml: lint, typecheck, unit + recurrence (3 TZs), integration on Postgres 18, migration lint, build"]
    CI -->|"merge to main"| BUILD["build + push images, tag = git SHA, upload source maps"]
    BUILD --> STG["deploy staging: restore point, migrate, up --wait, smoke test"]
    STG -->|"manual promote, same SHA"| PROD["deploy prod: restore point, migrate, up --wait, smoke test"]
    PROD -->|"health or smoke fails"| RB["auto-rollback app to previous SHA"]
```

**`.github/workflows/ci.yml` (sketch):**

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
      TZ: UTC
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test                     # unit + recurrence, fixed fast-check seed
      - run: pnpm db:migrate               # every migration applies to an empty DB
      - run: pnpm db:seed                  # seed still valid on the new schema
      - run: pnpm test:integration         # API + SQL against real Postgres
      - name: Lint new migrations (squawk)
        run: |
          git diff --name-only --diff-filter=A origin/main...HEAD -- 'apps/api/migrations/*.sql' \
            | xargs -r npx --yes squawk-cli
      - run: npx --yes gitleaks@latest detect --no-banner || exit 1   # or the gitleaks action

  recurrence-tz:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        tz: [UTC, Asia/Kolkata, America/New_York]   # IST has no DST; New York catches DST bugs
    env:
      TZ: ${{ matrix.tz }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter recurrence test
```

Why the time-zone matrix: the recurrence engine must give identical results whatever the *machine's* TZ is, because user TZ is data. Code that accidentally calls `new Date().getDate()` passes on your IST laptop and fails in UTC CI. The matrix catches that on the PR rather than at 00:30 IST in prod. A separate **nightly** workflow runs the property-based recurrence suite with random seeds and `numRuns: 10000`, prints the failing seed, and opens an issue if it fails.

**`.github/workflows/deploy.yml` (sketch):**

```yaml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      sha:
        description: "Image tag (git SHA) already verified on staging"
        required: true
permissions:
  contents: read
  packages: write

jobs:
  build:
    if: github.event_name == 'push'
    runs-on: ubuntu-24.04-arm          # native arm64 for an Ampere box (free on public repos); ubuntu-24.04 for x86
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          target: api
          push: true
          build-args: GIT_SHA=${{ github.sha }}
          tags: ghcr.io/${{ github.repository_owner }}/planner-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: docker/build-push-action@v6
        with:
          target: web
          push: true
          build-args: GIT_SHA=${{ github.sha }}
          tags: ghcr.io/${{ github.repository_owner }}/planner-web:${{ github.sha }}
      # + sentry-cli: create release ${{ github.sha }}, upload web source maps

  staging:
    needs: build
    runs-on: ubuntu-24.04
    environment: staging
    steps:
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ vars.DEPLOY_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh && echo "$SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          echo "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh deploy@${{ vars.DEPLOY_HOST }} "/srv/planner/infra/bin/deploy.sh staging ${{ github.sha }}"

  production:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-24.04
    environment: production            # required reviewer = you; a deliberate pause
    steps:
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ vars.DEPLOY_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh && echo "$SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
          echo "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh deploy@${{ vars.DEPLOY_HOST }} "/srv/planner/infra/bin/deploy.sh prod ${{ inputs.sha }}"
```

During v0–v1, while you're the only user, you can add `production` to the push path and skip the manual gate. Turn the gate on before anyone else depends on the app. The `deploy` SSH user should only be able to run `deploy.sh`: use a `command=` restriction in `authorized_keys`, so a leaked CI key can't get a shell.

**`infra/bin/deploy.sh` (the heart of it):**

```bash
#!/usr/bin/env bash
set -euo pipefail
ENV="$1"; SHA="$2"
cd "/srv/planner/$ENV"
PREV="$(cat .current_sha 2>/dev/null || true)"
export IMAGE_TAG="$SHA"

sops -d "/srv/planner/infra/secrets/$ENV.env.sops" > .env && chmod 600 .env
# prod owns Caddy (web) and Postgres (db); staging only runs api + worker
if [ "$ENV" = prod ]; then APP_SVCS="api worker web"; else APP_SVCS="api worker"; fi
docker compose pull $APP_SVCS

# 1. Named restore point: PITR target if this deploy corrupts data (free; needs WAL archiving to be useful)
docker compose exec -T db psql -U planner -d postgres -c "select pg_create_restore_point('pre-deploy-$ENV-$SHA');" || true

# 2. Migrations run once, in a one-off container from the NEW image, before any app swap
docker compose run --rm api node dist/migrate.js

# 3. Swap app containers; --wait blocks until healthchecks pass (Caddy retries hide the gap)
if docker compose up -d --wait --wait-timeout 90 $APP_SVCS; then
  ./smoke.sh "$ENV" && echo "$SHA" > .current_sha && exit 0
fi

echo "Deploy of $SHA failed health/smoke; rolling back app to $PREV" >&2
curl -fsS -d "deploy $ENV $SHA failed, rolled back to $PREV" "https://ntfy.sh/$NTFY_TOPIC" || true
[ -n "$PREV" ] && IMAGE_TAG="$PREV" docker compose up -d --wait $APP_SVCS
exit 1
```

**Migration safety (expand/contract):**

1. **Expand:** add new columns as nullable or with a constant default (cheap in modern Postgres), add new tables, add indexes with `CREATE INDEX CONCURRENTLY`. Deploy code that writes both the old and new shape.
2. **Migrate data** in a batched backfill job in the worker. Never run a single giant `UPDATE` inside the migration.
3. **Switch reads** to the new shape in a later deploy.
4. **Contract:** drop old columns in a *separate, later* release, only once no running image (including the previous one you might roll back to) still reads them.

Rules enforced by convention and squawk:

- Every migration file starts with `SET lock_timeout = '3s'; SET statement_timeout = '60s';`, so a migration that can't get its lock fails fast instead of queueing every request behind it.
- `CREATE INDEX CONCURRENTLY` goes in its own non-transactional migration, preceded by `DROP INDEX CONCURRENTLY IF EXISTS`, because a failed concurrent build leaves an `INVALID` index.
- No `NOT NULL` added to existing big tables without `NOT VALID` check-constraint staging.
- No column renames. Add the new column and drop the old one later.

**There are no down-migrations in prod.** A down-migration is untested code that runs during your worst moment. **Rollback strategy:** app-level rollback means redeploying the previous SHA, which is always safe because the schema is expand-only. Data-level rollback means PITR to the `pre-deploy-*` restore point, accepting the loss of writes since then (documented in RUNBOOK with how to export them first).

### 5.13 Backups and restore

**Phase 1 (v0, dogfooding): nightly logical dumps.**

```bash
#!/usr/bin/env bash
# infra/bin/backup.sh — systemd timer at 22:00 UTC (03:30 IST), Persistent=true catches missed runs
set -euo pipefail
source /srv/planner/infra/bin/env.sh        # HC_BACKUP_URL, BACKUP_AGE_PUBKEY, rclone remote "r2"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
curl -fsS -m 10 "$HC_BACKUP_URL/start" >/dev/null || true
cd /srv/planner/prod
docker compose exec -T db pg_dump -U planner -d planner -Fc --no-owner \
  | age -r "$BACKUP_AGE_PUBKEY" \
  | rclone rcat "r2:planner-backups/daily/planner-$TS.dump.age"
if [ "$(date -u +%u)" = 7 ]; then
  rclone copyto "r2:planner-backups/daily/planner-$TS.dump.age" "r2:planner-backups/weekly/planner-$TS.dump.age"
fi
if [ "$(date -u +%d)" = 01 ]; then
  rclone copyto "r2:planner-backups/daily/planner-$TS.dump.age" "r2:planner-backups/monthly/planner-$TS.dump.age"
fi
curl -fsS -m 10 "$HC_BACKUP_URL" >/dev/null       # success ping; missing ping = phone alert
```

- **Encryption:** `age` with only the *public* key on the server. The private key lives in your password manager plus on paper. So even a leaked R2 token reveals nothing.
- **Retention via R2 lifecycle rules:** `daily/` 14 days, `weekly/` 8 weeks, `monthly/` 6 months.
- **Optional second copy:** a weekly `rclone copy` to Backblaze B2 with Object Lock enabled, so an attacker holding the server's R2 credentials can't delete every copy.
- `pipefail` matters: without it, a failed `pg_dump` piped into a successful upload produces a "successful" empty backup.

**Weekly automated restore drill** (Sundays 23:00 UTC, on the box):

```bash
#!/usr/bin/env bash
# infra/bin/restore-drill.sh — proves the newest backup restores, then becomes staging's data
set -euo pipefail
source /srv/planner/infra/bin/env.sh
LATEST="$(rclone lsf r2:planner-backups/daily/ | sort | tail -1)"
rclone cat "r2:planner-backups/daily/$LATEST" | age -d -i /etc/planner/backup-drill.key > /tmp/drill.dump
cd /srv/planner/prod
docker compose exec -T db psql -U planner -d postgres -c "DROP DATABASE IF EXISTS planner_restore_check;"
docker compose exec -T db psql -U planner -d postgres -c "CREATE DATABASE planner_restore_check;"
docker compose exec -T db pg_restore -U planner -d planner_restore_check --no-owner < /tmp/drill.dump
# Assertions: schema version matches prod, core tables non-empty, data is fresh
docker compose exec -T db psql -U planner -d planner_restore_check -v ON_ERROR_STOP=1 -tAc "
  DO \$\$ BEGIN
    IF (SELECT count(*) FROM users) = 0 THEN RAISE EXCEPTION 'no users'; END IF;
    IF (SELECT max(updated_at) FROM tasks) < now() - interval '30 hours' THEN RAISE EXCEPTION 'stale backup'; END IF;
  END \$\$;"
# Promote into staging: swap databases, then scrub
docker compose exec -T db psql -U planner -d postgres -c "DROP DATABASE IF EXISTS planner_staging WITH (FORCE);"
docker compose exec -T db psql -U planner -d postgres -c "ALTER DATABASE planner_restore_check RENAME TO planner_staging;"
docker compose exec -T db psql -U planner -d planner_staging -f - < /srv/planner/infra/sql/scrub-staging.sql
rm -f /tmp/drill.dump
curl -fsS -m 10 "$HC_RESTORE_URL" >/dev/null
```

The drill key is a *second* age identity, added as an extra recipient on backups, so it can be revoked separately from your master key. A box compromise already exposes the live database, so keeping a decryption key there adds no new exposure.

**Quarterly evacuation drill (manual, timed, logged in JOURNEY):** create a fresh VPS at a *different* provider (or a local Docker host) → `bootstrap.sh` → `sops -d` → restore from R2 with your master key → point the Cloudflare origin to it → run the smoke tests → destroy it. Target **RTO ≤ 2 h**. The first run will probably take an afternoon and reveal three missing steps in RUNBOOK. That's the point. This is the only test that proves you can survive losing the box, which on Oracle Always Free is a real scenario.

**Phase 2 (before public signup): continuous archiving and PITR with WAL-G to R2.**

```conf
# postgresql.conf additions (custom image: FROM postgres:18 + wal-g binary for your arch)
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 900        # 15 min. NOT 60s — see Traps
```

Env for WAL-G: `WALG_S3_PREFIX=s3://planner-wal/prod`, `AWS_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `AWS_REGION=auto`, `AWS_S3_FORCE_PATH_STYLE=true`, `WALG_COMPRESSION_METHOD=zstd`, `WALG_LIBSODIUM_KEY` (or GPG) for encryption. Run `wal-g backup-push` weekly and `wal-g delete retain FULL 4 --confirm` after it. **Restore to a point:** `wal-g backup-fetch $PGDATA LATEST`, set `restore_command = 'wal-g wal-fetch %f %p'` and `recovery_target_name = 'pre-deploy-prod-<sha>'` (or `recovery_target_time`), touch `recovery.signal`, start, verify, then promote.

| | Phase 1 (dumps only) | Phase 2 (+ WAL-G) |
|---|---|---|
| **RPO** (data you can lose) | up to 24 h | ≤ 15 min (`archive_timeout`) |
| **RTO** (time to restore) | ~30 min on the same box, ≤ 2 h on a new box | same |
| **Restore granularity** | last night | any second, or any named pre-deploy point |
| **Monitoring** | Healthchecks ping | + alert if `pg_stat_archiver.last_failed_time > last_archived_time` |

**Data protection note:** India's DPDP Act (2023) and its 2025 Rules apply once others use the app. A deleted account still exists in backups until retention expires (≤6 months for monthly backups). Say so in the privacy policy. If a backup is restored, re-apply deletions from a small `deletion_log` table that is excluded from the restore scope. This is cheap to add now and painful to retrofit.

### 5.14 Logging, monitoring and alerting

| Signal | v0–v1 (₹0) | v2+ (still ₹0) |
|---|---|---|
| **Logs** | `pino` JSON to stdout → Docker `local` driver (rotated). Read with `docker compose logs -f api \| pino-pretty`. Every line has `req_id`, `user_id` (hashed), `route`, `status`, `ms`, `release`. | Grafana Alloy → Grafana Cloud Loki free (50 GB/month, 14 days). Alloy costs ~100 MB RAM, so skip it on a 2 GB box until needed. |
| **Errors** | Sentry, both frontend and backend. Release = Git SHA. Source maps uploaded in CI. `beforeSend` scrubs emails and tokens. Inbound filter for browser-extension noise. | Same. Add a rate limit per issue so one hot-path bug doesn't burn the monthly quota in an hour. |
| **Uptime** | UptimeRobot: `https://tasks.ahmedatif.in/api/healthz` (checks DB), `https://tasks.ahmedatif.in/` (static), `https://api.ahmedatif.in/healthz`, and SSL-expiry monitors on both. | Public status page on `status.ahmedatif.in`. |
| **Dead-man's switches** | Healthchecks.io: `worker-tick` (1 min/5 min grace), `backup-nightly` (1 day/2 h), `restore-drill` (7 days/1 day). | + `wal-archive` (a cron that checks `pg_stat_archiver`), `origin-cert` (see below). |
| **Box health** | `check-disk.sh` every 10 min: ntfy at >80% on `/` and the Docker volume. `check-origin-cert.sh` daily: `openssl s_client -connect 127.0.0.1:443 -servername tasks.ahmedatif.in` → ntfy if fewer than 14 days remain. (Cloudflare hides the origin certificate from external monitors, and an expired origin certificate shows up as a Cloudflare 526 error.) | node_exporter + postgres_exporter → Grafana Cloud free (well under 10k series). One dashboard: req/s, p95 latency, 5xx rate, job lag, push success rate, DB size, connections, disk. |
| **Alerts to phone** | ntfy app subscribed to a long random topic. Healthchecks, scripts and the deploy script post to it. UptimeRobot alerts by email; Better Stack free has app push if you prefer. | Quiet hours: only `urgent` priority (site down, disk >90%, backup missed twice) bypasses Do Not Disturb. |

**SLO:** write it down. **99.5% monthly availability** for `/api/healthz` (about 3.6 h of downtime allowed) and **reminders delivered within 5 minutes of their scheduled time for 99% of sends**. You're a student with exams, and 99.9% would be dishonest. An explicit SLO is also an excellent interview answer to "how did you decide what reliability was enough?"

### 5.15 Rate limiting, abuse and CORS

**Real client IPs first.** Behind Cloudflare, use `CF-Connecting-IP` via Caddy's `client_ip_headers` (§5.9). Key IPv6 limits on the **/64 prefix**. Indian mobile carriers put huge numbers of users behind carrier-grade NAT (CGNAT), so **per-IP limits must be generous**. Key on email, account or token wherever possible.

| Surface | Key | Limit (start) | On exceed |
|---|---|---|---|
| `POST /api/auth/magic-link` | target email | 5 / hour | 429. The response is identical whether or not the email exists |
| same | client IP (or /64) | 30 / hour | 429. Turnstile is required once public signup opens |
| Authenticated PWA API | user ID | 300 / min, burst 60 | 429 + `Retry-After` |
| `POST /heartbeat` (D-009) | token ID | 10 / min (a normal client sends 0.5/min) | 429. The client coalesces and retries later |
| Integration events (commits) | token ID | 60 / min, plus a per-user cap of 600 / min across all tokens | 429. Client spools to `~/.planner/queue` |
| Request body | — | 1 MB JSON (captures/audio go through a separate upload path, if any) | 413 |
| Edge backstop | IP | Cloudflare's 1 free rule on `/api/auth/*` | block 10 s |

**Implementation:** in-process token buckets (the Fastify/Hono rate-limit plugin) while there's a single API process. That's correct, simple and fast. When there are two or more replicas, move counters to an `UNLOGGED` Postgres table (no WAL, so cheap and not backed up), or to Valkey if 05 has introduced it. **Integration tokens:** scoped (`heartbeat:write`, `sessions:write`, `tasks:read`), hashed at rest, prefixed `plnr_` so `gitleaks` and code searches can spot leaks, and revocable from the settings page. "Last used at / from IP" is shown to the user. Commit events are idempotent on `(user_id, repo_id, sha)`, so retries after a 429 never duplicate.

**Signup abuse (when public):** Turnstile on the email form, per-account quotas (tasks, dump items, upload bytes), an optional disposable-domain blocklist, and a kill switch env var `SIGNUPS_OPEN=false`.

**CORS:**

- `tasks.ahmedatif.in/api/*`: **same-origin, so no CORS headers at all.** This also removes preflight round trips. Chrome caps the preflight cache at 2 hours, so a cross-origin design would add an extra ~40–70 ms round trip to many writes from India.
- `api.ahmedatif.in`: bearer tokens only, cookies ignored. The VS Code extension, git hook and Claude Code hooks aren't browsers, so CORS doesn't apply to them. A future MV3 browser extension making requests from its **background service worker** with `host_permissions` for `https://api.ahmedatif.in/*` isn't subject to CORS either. Content scripts are, so don't fetch from content scripts. Default policy: no `Access-Control-Allow-Origin` except an explicit allowlist (`chrome-extension://<published-id>`, `moz-extension://<id>`) if ever needed. Never use `*` together with credentials.

### 5.16 Cost at 1 vs 1k vs 10k users

**Assumptions** (state them in interviews; they're the model, not facts):

- "Users" means monthly-active accounts. **DAU = 40% of users.**
- Each DAU makes **150 API calls/day** (opens, sync pulls, edits, timer start/stop) and gets **3 pushes/day** (shutdown reminder + 2 others).
- **20% of DAU use coding integrations** about 3 h/day. Per D-009 that's 1 heartbeat per 2 min ≈ **90 heartbeats/day**, plus ~10 commit events.
- **Peak = 10× the average** (evening IST).
- **Email:** about 1.5 magic links per user per month (30-day sessions, several devices) + signups.
- **DB growth:** about **2 MB per active user per year** including indexes, excluding audio.
- **Voice audio, if stored:** about 60 KB per note (30 s Opus at ~16 kbps), 10 notes/week ≈ **30 MB/user/year**.
- **Logs:** about 400 bytes per request.

| Quantity | 1 user | 1k users | 10k users |
|---|---|---|---|
| API requests/day | ~250 | ~68k (≈0.8 req/s avg, ~8 peak) | ~680k (≈8 req/s avg, ~80 peak) |
| Heartbeat writes/day (D-009) | ~90 | ~7.2k | ~72k |
| Push sends/day | 3 | 1.2k | 12k |
| Emails/month | <5 | ~1.5–2k (spiky) | ~15–20k |
| DB size after 1 year | ~2 MB | ~2 GB | ~20 GB |
| Audio after 1 year (if kept) | 30 MB | 30 GB | 300 GB |
| Logs/month | trivial | ~0.8 GB | ~8 GB |

| Line item (USD/month) | 1 user | 1k users | 10k users |
|---|---|---|---|
| Compute (app + DB on one box) | **$0** Oracle A1, or ~$6–12 India VPS | **$0** Oracle, or ~$12 (2 GB) | ~$20–50 (4–8 GB India VPS). Or split: app box + managed DB (Neon Launch with 1 CU always on ≈ 730 × $0.106 ≈ $77 + 20 GB × $0.35 ≈ $7) |
| Cloudflare (DNS/CDN/TLS/WAF) | $0 | $0 | $0 (Pro is optional for more WAF/rate rules) |
| Backups (R2) | $0 | $0–0.10 (dumps ~0.5 GB × 28 retained ≈ 14 GB) | ~$0.30–0.60 (WAL-G: 2 weekly bases + WAL ≈ 25–45 GB) |
| Email | $0 (Resend free) | **Resend free breaks on peak days** → SES ~$0.20, or ZeptoMail ~$2.50 credit lasting months, or Resend Pro (~$20) | SES ~$2 / ZeptoMail ~$5 |
| Error tracking | $0 | $0 (Student Pack 50k/year), else free 5k with strict sampling | Sentry Team (~$26, exact price unverified), or self-host GlitchTip on the box |
| Uptime / cron monitoring / alerts | $0 | $0 | $0 |
| Logs/metrics | $0 (on box) | $0 | $0 (Grafana Cloud free: 8 GB logs < 50 GB) |
| Push | $0 | $0 | $0 |
| CI | $0 (public repo) | $0 | $0 |
| Audio storage (only if A9 is wrong) | $0 | ~$0.30 (R2) | ~$4.50/month and growing ~$4.50 per year of retention |
| **Total** | **$0–6** | **$0–15** | **~$45–100** self-hosted; **~$120–150** with managed DB + paid Sentry |

**Which free tier breaks first:**

1. **Resend's 100 emails/day** cap. It breaks on the first day more than ~100 people request a magic link, for example one Reddit or LinkedIn post. Sending *pauses*, which means **people can't log in**. Switch to SES or ZeptoMail *before* any public launch, and keep Resend as the fallback provider.
2. **Sentry's 5k errors/month** (non-Student). One error on a hot path × 1k users empties it in a day, and then you're blind exactly when you need visibility.
3. **R2's 10 GB.** Breaks at roughly 1k users with dump retention, or *immediately* with a 60-second `archive_timeout` (see Traps).
4. **Audio storage,** if 11 keeps raw voice notes.
5. **Compute is the last to break.** The D-009 math holds: even 10k concurrent coders ≈ 83 heartbeat writes/s, which a 2-vCPU Postgres handles. Oracle's free box doesn't *break* under load. It *vanishes* under policy. Different risk, different mitigation (§5.13 evacuation drill).

For comparison at **1 user**: approach B costs roughly $20–30/month (Fly `sin` shared-cpu-1x 512 MB is about $3.69 × 1.269 region multiplier ≈ $4.70 per machine, × 2 for api and worker, plus Neon Launch ≈ $19 because the worker keeps compute awake). Render is about $20 (Starter $7 × 2 + Basic-256mb Postgres $6). Railway is about $5–10 (Hobby $5 including $5 of usage). Approach C costs $0 at 1 user and about $15–25 at 10k (Workers Paid $5 + requests over 10M at $0.30/M + D1 storage over 5 GB at $0.75/GB), which is the cheapest at scale but has the redesign costs described in §3.

### 5.17 What "production-grade" means at each scale

| Scale | Must have | Deliberately NOT yet |
|---|---|---|
| **1 user (v0–v1)** | HTTPS everywhere, CI gates (lint/typecheck/tests/migrations from zero), one-command deploy + rollback, nightly encrypted backups **that have been restored at least once**, Sentry, uptime alert, worker dead-man's switch, disk alert, secrets out of git (or encrypted in it). | Staging, PITR, status page, metrics dashboards, rate limiting beyond the auth endpoint, zero-downtime deploys. |
| **~100–1k users (public signup, v2–v3)** | Everything above, plus: PITR (RPO ≤ 15 min), staging that is yesterday's prod, a manual prod promote gate, rate limits on every surface + Turnstile, email provider without a daily cap, SPF/DKIM/DMARC at `p=quarantine`, written SLO, RUNBOOK + a completed evacuation drill, privacy policy, data export + account deletion, dependency updates (Renovate/Dependabot), token revocation UI. | A second server, Redis, read replicas, multi-region, Kubernetes, paid observability. |
| **~10k users** | Database on its own box or managed Postgres. Two API replicas behind Caddy (Postgres-backed rate counters, `LISTEN/NOTIFY` for realtime fan-out). PgBouncer if connection counts grow. Log shipping + one metrics dashboard. Capacity alerts (DB size, connections, job lag). Quarterly restore *and* evacuation drills. Security headers review. Maybe Cloudflare Pro for more WAF rules. | Kubernetes, multi-region active-active, microservices, Kafka, service mesh, a self-hosted observability stack, custom autoscaling. |

### 5.18 Order of work (mapped to the roadmap)

1. **Before v0 code (one evening):** move `ahmedatif.in` nameservers to Cloudflare. Set up Email Routing for `ops@`/`dmarc@`. Create the repo (public), `ci.yml` (lint/typecheck/test on an empty project), `compose.dev.yaml` with Postgres 18 + Mailpit, `.env.example` + zod env validation.
2. **v0 (recurring calendar), first deploy:** get the box (Oracle attempt, else India VPS). `bootstrap.sh`. Caddy + compose. `deploy.yml` (build → prod directly). `/healthz`. Sentry. UptimeRobot. ntfy. `backup.sh` + **one manual restore** written up in JOURNEY. Seed script. Recurrence TZ matrix in CI. *Dogfood for 2 weeks.*
3. **v1 (tasks, timer, sessions, dump):** worker process + Healthchecks dead-man. Staging project + automated weekly restore drill into staging. SOPS secrets. Squawk migration lint. `lock_timeout` convention.
4. **v2 (reminders, attendance confirm):** VAPID keys (stored safely), push send path + 410 cleanup, reminder idempotency table, catch-up policy, `FAKE_NOW` tests. Email domain hardening (DMARC), switch the magic-link provider to SES or ZeptoMail, Turnstile, full rate-limit table, manual prod promote gate. **WAL-G PITR + `pre-deploy` restore points.** First evacuation drill. SLO written down.
5. **v3 (git hook → VS Code → Claude Code):** `api.ahmedatif.in` host, token scopes + per-token limits, idempotent commit events, client spool/backoff contract documented for 08, CORS allowlist policy (empty by default).
6. **Later / ~5k users:** Grafana Cloud metrics, split DB off the box or go managed, second API replica, `UNLOGGED` rate counters, status page.

---

## 6. Traps (things that look cool but eat weeks)

1. **A self-hosted observability stack on the app box.** Prometheus + Grafana + Loki + Alertmanager is a weekend to set up, a month to tune, and 1–2 GB of RAM. On a 2 GB box it will OOM-kill Postgres. Use Sentry + Healthchecks + uptime + ntfy now, and Grafana Cloud free later.
2. **Kubernetes or k3s "to learn it" on the prod box.** You'll learn Kubernetes, not ship a planner. If you want K8s on the CV, do it in a separate throwaway project.
3. **Terraform/Pulumi for one VPS.** The cloud APIs (especially Oracle's) are the hard part, and you'll provision this box maybe three times in its life. `bootstrap.sh` + RUNBOOK + the evacuation drill give more confidence per hour.
4. **Per-PR full-stack preview environments** with database branching, wildcard DNS and per-PR TLS. Impressive, but there are no reviewers. One staging that is yesterday's prod catches more bugs.
5. **Chasing zero-downtime deploys.** Caddy's `lb_try_duration` turns a 3–5 s restart into a slow request, and the PWA retries anyway. Kamal 2 or blue/green is the upgrade path *when someone complains*, not before.
6. **Coolify or other self-hosted PaaS panels on a small box.** Coolify idles at about 1.5–2 GB RAM (secondary). It's another internet-exposed admin UI to patch (it has had CVEs), and when it breaks you debug the PaaS instead of your app.
7. **Free-tier hopping:** designing around Render's 15-minute sleep, Supabase's 7-day pause or Neon's CU-hours. The product has an always-on worker. Accept it.
8. **Short `archive_timeout`.** PostgreSQL's docs warn that segments archived early because of a forced switch are still full-size (16 MB), so very short timeouts bloat the archive. With heartbeats writing every couple of minutes during active hours, `archive_timeout = 60` can archive hundreds of mostly empty 16 MB segments a day and blow through R2's 10 GB in about a week. Use 900 s (15 min) and accept the RPO.
9. **Docker published ports bypass ufw.** `ports: ["5432:5432"]` on Postgres exposes it to the internet even when `ufw deny 5432` is set. Never publish DB ports. Use the provider firewall for 80/443.
10. **`docker compose down -v`** deletes named volumes, which means your database. Alias it away on the server, and keep backups regardless.
11. **The postgres:18 PGDATA change.** Copy-pasted `- pgdata:/var/lib/postgresql/data` mounts stop PG18 from starting. Mount `/var/lib/postgresql` (§5.8). Test it by recreating the container and checking the data survived.
12. **Unrotated Docker logs.** The default `json-file` driver grows without bound. Set `"log-driver": "local"` in `daemon.json` on day one.
13. **Cloudflare "Flexible" SSL**: plaintext to the origin plus redirect loops. Always Full (strict).
14. **HSTS preload / apex `includeSubDomains`** before every future subdomain is HTTPS. It's effectively permanent.
15. **Second-level staging hostnames** (`staging.tasks.ahmedatif.in`) aren't covered by free Universal SSL. Use `tasks-staging.`.
16. **Bot Fight Mode / "Under Attack" mode** challenges non-browser clients and silently breaks the git hook and VS Code integration.
17. **Cached service worker at the edge.** `sw.js` cached by Cloudflare or the browser pins users to an old app version. `no-cache` on `sw.js`, `index.html` and the manifest. Long `immutable` caching only for hashed assets.
18. **Rotating VAPID keys** orphans every push subscription.
19. **ARM/x86 image mismatch** on Oracle Ampere: an amd64 image fails with `exec format error`, and QEMU cross-builds take 10–20 minutes. Build on `ubuntu-24.04-arm` (free on public repos), or publish multi-arch images.
20. **Oracle's double firewall** (VCN security list *and* the iptables rules shipped in the Ubuntu image). Budget an hour, and write it down.
21. **Third-party hostnames in clients** (`*.supabase.co`, `*.fly.dev`, `*.pages.dev`, `*.workers.dev`). Indian ISP blocks have happened. Clients only ever talk to `*.ahmedatif.in`.
22. **Running your own mail server** for magic links. Deliverability to Gmail is a career, not a weekend.
23. **Writing down-migrations "for safety"** and trusting them in prod.
24. **Vault or a secrets SaaS** for six secrets. SOPS + age is enough and is recoverable from git.

---

## 7. Edge cases and tests

| # | Scenario | Expected handling | How to test |
|---|---|---|---|
| 1 | **Migration fails halfway during deploy** | Postgres transactional DDL rolls the migration back. `deploy.sh` exits *before* swapping containers, so the old app keeps serving on the old schema. An ntfy alert goes out. For a failed `CREATE INDEX CONCURRENTLY` (not transactional), an `INVALID` index remains, and the migration's leading `DROP INDEX CONCURRENTLY IF EXISTS` makes the retry clean. | In staging, a deliberately failing migration (`SELECT 1/0` after a DDL). Assert the schema is unchanged and the old SHA is still serving. |
| 2 | **Migration succeeds, new app fails health/smoke** | `up --wait` times out or smoke fails. Auto-rollback to `$PREV` (safe because the migration was expand-only). Alert. | A staging deploy of an image whose `/healthz` returns 500. |
| 3 | **Bad deploy corrupts data, discovered hours later** | Stop writes (maintenance flag). Export rows changed since `pre-deploy-<sha>`. PITR the database to the restore point (from Phase 2). Replay or hand-merge the exports. Post-mortem in JOURNEY. | Quarterly drill: PITR staging to a named restore point and verify that a row inserted after it is gone. |
| 4 | **Origin TLS certificate expired** (renewal failed, e.g. port 80 blocked) | Cloudflare shows error 526 to users. `check-origin-cert.sh` should have alerted 14 days earlier. Fix: unblock or switch to DNS-01, then `docker compose restart web`. | Point the check script at a deliberately short-lived self-signed certificate on a test hostname. |
| 5 | **Edge certificate problem / Cloudflare outage / ISP blocks a Cloudflare range** | Grey-cloud `tasks` and `api` (DNS only). The origin's own Let's Encrypt certificate serves directly. Origin firewall rule: temporarily allow 443 from anywhere. Revert afterwards. | Once in staging: grey-cloud `tasks-staging` and confirm it still serves valid TLS. |
| 6 | **DB disk full** | Postgres PANICs on WAL write and goes read-only or down. Prevention: alert at 80%, log rotation, retention. Common hidden cause: **WAL archiving failing** (expired R2 token) makes `pg_wal` grow without bound. Fix: restore credentials, let the archiver catch up, then free space. | Fill a test volume in staging. Revoke the R2 token in staging and confirm the `wal-archive` check alerts before the disk fills. |
| 7 | **Nightly backup silently empty** | `pipefail` fails the script, so there's no success ping and Healthchecks alerts. The restore drill's freshness and non-empty assertions also fail. | Temporarily break `pg_dump` credentials in staging. |
| 8 | **Restore drill fails** | Treat it as a P1, even though prod is up: you currently have no proven backup. Fix before any deploy. | It's the drill itself. Also check that a *missing* drill ping alerts after 8 days. |
| 9 | **Box reclaimed or deleted** (Oracle policy, account issue) | Evacuation runbook: new VPS → bootstrap → restore → change origin in Cloudflare. RTO ≤ 2 h, RPO = last dump or last WAL segment. Installed PWAs keep working offline in the meantime, assuming 09's offline queue. | The quarterly evacuation drill, timed and logged. |
| 10 | **Worker dead or hung** | Healthchecks `worker-tick` alerts within ~6 min. Docker restarts crashes. A hang (event loop blocked) is caught only by the dead-man. Late reminders use the catch-up policy (≤2 h late, else skip). | Kill `-STOP` the worker in staging. Confirm the alert and that resumed ticks don't double-send (unique key). |
| 11 | **Reminder at the IST date boundary** | A reminder at 00:15 IST belongs to the IST date, not the UTC date (18:45 UTC the previous day). Server in UTC, user tz from data. | `FAKE_NOW=2026-10-05T18:45:00Z`, user tz `Asia/Kolkata`: assert `local_date = 2026-10-06`. Same suite under the CI TZ matrix. |
| 12 | **Push subscription expired / user reinstalled the PWA** | Push service returns 404/410, so delete the subscription. On 429, back off. If a user has zero subscriptions left, show an in-app banner next time. | Unit test with a mocked push endpoint returning 410. |
| 13 | **Email provider daily cap or outage** | The magic-link request returns a clear "we couldn't send the email, try again in a few minutes" message rather than a fake success. Fall back to the secondary provider. Alert on the first fallback. | Mock provider returning 429 in integration tests. |
| 14 | **Integration token leaked and hammering the API** | Per-token 429s cap the damage. The user (or you) revokes the token from settings and the revocation is immediate (checked against the hash on every request). Alert on sustained 429s for one token. | Load script: 1,000 heartbeats/min with one token → expect ~10 accepted, the rest 429, other users unaffected. |
| 15 | **All users behind one Jio CGNAT IP** | Per-IP limits are generous. Per-email/account/token limits do the real work. | Integration test: 50 distinct users from the same IP all log in successfully. |
| 16 | **Rate limiter sees Cloudflare's IP instead of the client's** | Without `client_ip_headers`, everyone shares a few Cloudflare IPs and gets throttled together. | Staging test: two clients through Cloudflare. Assert the logged `client_ip` differs from Cloudflare ranges. |
| 17 | **Stale PWA client after an API change** | The API stays backward compatible with the previous client release (expand/contract applies to API shapes too). The client sends `X-Client-Release`. Below a `MIN_CLIENT_RELEASE`, the API returns 426 and the SW update prompt reloads. | e2e: load release N, deploy N+1, assert N still works or gets a clean upgrade prompt. |
| 18 | **SSE/WebSocket dropped by the proxy after ~100 s idle** | 30 s keepalive comments or pings. The client reconnects with backoff and resyncs. | Staging: an idle connection held for 5 min stays open. |
| 19 | **Staging accidentally contacts real users** | Scrub script deletes push subscriptions. `EMAIL_MODE=log` and `PUSH_MODE=log` in staging env. | Assert in the restore-drill script: `SELECT count(*) FROM push_subscriptions` = 0 in staging. |
| 20 | **Secret committed to git** | gitleaks fails CI. Rotate the secret immediately; deleting it from git is not enough. For VAPID specifically, plan a resubscribe. | gitleaks with a planted fake key in a test branch. |
| 21 | **Postgres major upgrade (18 → 19)** | Not urgent. 18 is supported for years. When needed: dump/restore into a new `postgres:19` container in staging first, run the full test suite + restore drill, then repeat in prod in a maintenance window. | A staging rehearsal is the test. |
| 22 | **Clock drift on the VPS** | `chrony` keeps the clock in sync. Session gap math and reminder timing assume an accurate `now()`, so alert if `chronyc tracking` shows more than 1 s offset. | `check-disk.sh` also checks the chrony offset. |
| 23 | **Deleted user's data reappears after a restore** | Re-apply `deletion_log` after any restore (§5.13). | Restore drill: delete a test user, restore yesterday's backup to staging, apply the log, assert the user is gone. |

---

## 8. Challenges to locked decisions

**None that need a reversal.** D-001 to D-010 are all compatible with this infra. One refinement to **D-009**, as a note rather than a challenge: the decision correctly says request rate isn't the problem (10k concurrent coders ≈ 83 req/s). The cost that *does* grow is **write amplification**. Each heartbeat is a row `UPDATE`, which produces WAL (plus full-page images after each checkpoint) and a dead tuple. At that scale that's millions of updates a day, which affects PITR archive size and autovacuum, not CPU. Keeping `last_seen` unindexed (so updates stay HOT), giving the sessions table a lower `fillfactor`, and optionally buffering `last_seen` in memory and flushing every few minutes are all compatible with D-009 as written. I've passed them to 04/05 as assumptions (A3).

---

## 9. Open decisions for Atif

| # | Question | Options | Suggested default |
|---|---|---|---|
| 1 | **Where does the box live?** | (a) Oracle Always Free A1, Hyderabad/Mumbai home region. (b) 2 GB India VPS for ~$10–12/month. (c) Hetzner EU CX23 at €5.49 (cheap, but 140–170 ms away). | **(a)** if you can get A1 capacity within one evening and upgrade to PAYG with a ₹1 budget alert. Otherwise **(b)**. Either way, run the evacuation drill once in the first month. |
| 2 | **Public or private repo?** | Public: unlimited Actions minutes, free ARM runners, public GHCR images, visible to interviewers. Private: 3,000 min/month with Pro, needs a PAT to pull images. | **Public**, with gitleaks in CI and SOPS-encrypted secrets. A planner's code isn't a secret, and the commit history is part of the showcase. |
| 3 | **Magic-link email provider** | Resend (best developer experience, 100/day cap), SES ($0.10/1k, needs sandbox exit approval), ZeptoMail (Indian company, INR, $2.50/10k credits). | **Resend now. SES or ZeptoMail before public signup**, with Resend kept as the fallback. |
| 4 | **PWA → API origin** | Same-origin `/api` vs a cross-origin `api.` subdomain with CORS. | **Same-origin** for the PWA. `api.` only for token clients. |
| 5 | **Origin TLS** | Caddy + Let's Encrypt; Cloudflare Origin CA cert (15-year, CF-only trust); Cloudflare Tunnel (no open ports, no certs). | **Caddy + Let's Encrypt.** Keeps the option of bypassing Cloudflare. Tunnel is a fine alternative if you'd rather have zero open ports. |
| 6 | **Staging** | None; on the same box with the prod Postgres cluster; separate box. | **Same box, separate database**, refreshed weekly by the restore drill. Add it at v1, not v0. |
| 7 | **Secrets** | Hand-managed `.env` on the server; SOPS + age in the repo; Doppler (free while a student). | **SOPS + age.** Recovery from git + one key. |
| 8 | **Backup depth and when** | Dumps only; dumps + WAL-G PITR from day one; PITR before public signup. | **Dumps at v0, PITR at v2** (before anyone else's data is on the box). |
| 9 | **Deploy tool** | Compose + `deploy.sh`; Kamal 2 (kamal-proxy, zero-downtime, built-in Let's Encrypt). | **Compose + script.** Revisit Kamal if deploy blips ever matter. |
| 10 | **Where do alerts go?** | ntfy; a Telegram bot; email only. | **ntfy** (one `curl`, works with Healthchecks). A Telegram bot is a fine swap if you live in Telegram. |
| 11 | **SLO** | 99.0 / 99.5 / 99.9% monthly. | **99.5%** availability + **99% of reminders within 5 min.** |
| 12 | **Voice audio retention** (coordinate with 11) | Don't store (transcribe on device); keep 30 days; keep forever. | **Don't store by default.** Keep for 30 days only if transcription fails, so you can retry. |
| 13 | **Manual prod gate timing** | From day one; from v2; never. | **From v2.** Before that you're the only user, and the gate just slows dogfooding. |

---

## 10. Proposed JOURNEY.md entries

### D-0XX · One India-region VPS, Docker Compose, Cloudflare in front (2026-10-05)
- **Decision:** Run Caddy, the API, a separate worker process and Postgres 18 on one VPS with Docker Compose. Default host: Oracle Always Free Ampere (Hyderabad/Mumbai, PAYG account, inside free limits). Fallback: a 2 GB VPS in Mumbai/Bangalore/Delhi. Cloudflare free plan for DNS, edge TLS, caching and a rate-limit backstop.
- **Why:** The product needs an always-on worker (reminders, session sweeper, push), which makes scale-to-zero PaaS/DB free tiers paid from day one. An Indian region keeps API round trips at ~5–40 ms instead of 140–170 ms (EU) or a Singapore detour. One box is cheap, fully explainable, and the box holds nothing that isn't in git or backups.
- **Alternatives considered:** PaaS + managed Postgres (Fly/Railway/Render + Neon/Supabase): no Indian region for most, and the always-on worker exhausts Neon's 100 CU-h free tier (0.25 CU × 730 h ≈ 182 CU-h). Cloudflare Workers + Durable Objects/D1: cheapest at scale, but it dictates a SQLite-per-user data model and Cloudflare-specific job semantics.
- **Consequence:** I'm the SRE and DBA. Mitigated by scripted bootstrap/deploy/backup, a weekly restore drill and a quarterly evacuation drill. Move the DB to managed Postgres first if upkeep goes over ~2 h/month or the DB passes ~20 GB.

### D-0XX · Clients only ever talk to *.ahmedatif.in; PWA uses same-origin /api (2026-10-05)
- **Decision:** The PWA calls `tasks.ahmedatif.in/api` (same origin, host-only `__Host-` cookie, no CORS). Integrations call `api.ahmedatif.in` with bearer tokens only, and that host ignores cookies. No client ever embeds a provider hostname.
- **Why:** No CORS preflights (an extra round trip from India on many writes), CSRF-proof token host, simplest cookie model. Indian ISPs DNS-blocked `*.supabase.co` for about a week in Feb 2026, so owning every client-facing hostname means any provider can be swapped with one DNS change.
- **Alternatives considered:** PWA on Cloudflare Pages + cross-origin API with CORS + credentials. A parent-domain cookie for future shared identity (rejected because of cookie-tossing risk; use an `accounts.` host with redirects later).

### D-0XX · Postgres is the only stateful service; no Redis yet (2026-10-05)
- **Decision:** Jobs and schedules use a Postgres-backed queue in a long-running worker. Rate-limit counters are in-process while there is one API replica, then an `UNLOGGED` Postgres table. Realtime fan-out across replicas uses `LISTEN/NOTIFY`.
- **Why:** One thing to back up, monitor and restore. At the projected 10k-user load (~8 req/s average, ~80 peak) Postgres has plenty of headroom.
- **Alternatives considered:** Redis/Valkey + BullMQ. Revisit only if job throughput or cross-replica rate limiting actually needs it.

### D-0XX · Backups that are proven by restoring them (2026-10-05)
- **Decision:** Nightly `pg_dump`, encrypted with `age` (public key only on the server), to Cloudflare R2, with lifecycle retention of 14 daily, 8 weekly and 6 monthly. A weekly automated restore drill restores into the staging database (so staging = yesterday's prod, scrubbed) and pings a dead-man's switch. A quarterly timed evacuation drill on a fresh box. WAL-G continuous archiving (`archive_timeout` 15 min) and named `pre-deploy` restore points before public signup.
- **Why:** A backup that has never been restored is a hope, not a backup. Combining the drill with the staging refresh makes it free and gives staging realistic data. Target RPO ≤ 15 min (after PITR) and RTO ≤ 2 h.
- **Consequence:** Deleted users persist in backups up to the retention window. Documented in the privacy policy, and a `deletion_log` is re-applied after any restore.

### D-0XX · CI/CD: same image from staging to prod; expand/contract migrations, no prod down-migrations (2026-10-05)
- **Decision:** GitHub Actions runs lint, typecheck, unit tests, recurrence tests under UTC/Asia/Kolkata/America/New_York machine time zones, integration tests on Postgres 18, squawk on new migrations, and gitleaks. Images go to GHCR tagged by SHA. `main` auto-deploys to staging. Prod is a manual promote of the same SHA (from v2). Deploy order: restore point → migrate in a one-off container → `up --wait` → smoke → auto-rollback of the app on failure.
- **Why:** Rolling back the app is always safe because migrations are expand-only. Data rollback is PITR, not untested down scripts. The TZ matrix catches accidental machine-local-time bugs in the recurrence engine.
- **Alternatives considered:** Kamal 2 for zero-downtime (deferred; Caddy `lb_try_duration` hides restart blips). Per-PR full-stack previews (deferred; there are no reviewers).

### D-0XX · Minimum observability: errors, uptime, dead-man's switches, phone alerts (2026-10-05)
- **Decision:** Sentry (Student Pack), UptimeRobot/Better Stack for HTTP + TLS checks, Healthchecks.io dead-man's switches for the worker tick, backups and restore drills, local scripts for disk and origin-certificate expiry, all alerting through ntfy. Logs stay on the box (rotated) until ~1k users, then go to Grafana Cloud free. Written SLO: 99.5% availability, 99% of reminders within 5 min.
- **Why:** The most likely silent failure is "reminders stopped" (a dead worker), which no uptime check notices. Let's Encrypt no longer emails about expiring certificates, and an expired origin certificate shows up only as a Cloudflare 526.
- **Alternatives considered:** A self-hosted Prometheus/Grafana/Loki stack (rejected: RAM and time).

### D-0XX · Email: transactional mail from a subdomain, provider without a daily cap before launch (2026-10-05)
- **Decision:** Send magic links from `mail.ahmedatif.in` with SPF, DKIM and DMARC (`p=none` → `quarantine`). Start on Resend's free tier, and switch to SES or ZeptoMail (Resend as fallback) before public signup.
- **Why:** Resend's free tier caps at 100 emails/day and *pauses* sending. One launch-day spike would lock people out of login. It's the first free tier this app breaks, well before compute.

### Proposed §5 risk-table rows

| Risk | Status | Mitigation |
|---|---|---|
| Free Oracle box reclaimed or terms changed (limits were halved quietly in mid-2026) | **Open** | PAYG account inside free limits; nothing on the box that isn't in git/R2; quarterly timed evacuation drill (RTO ≤ 2 h) |
| Shutdown reminders silently stop (worker dead or hung) | Addressed (design) | Healthchecks.io dead-man on every scheduler tick; idempotent sends; catch-up window ≤ 2 h |
| Magic-link email cap during a signup spike | **Open** until v2 | Move to SES/ZeptoMail before public signup; fallback provider; clear error UX |
| Indian ISP blocks a provider hostname | Addressed (design) | Clients only use `*.ahmedatif.in`; origin certificate allows bypassing Cloudflare |

---

### Sources (checked 2026-10-05)

- Hetzner price adjustment, 15 June 2026 (vendor): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner Singapore traffic and object storage gaps (secondary): https://bex.co/blog/2026/07/10/hetzner-singapore-region-apac-self-hosting
- Fly.io pricing, `bom` deprecation, `sin` multiplier, Managed Postgres (vendor): https://docs.fly.io/about/pricing , https://github.com/superfly/docs/pull/2506
- Neon free plan limits and Launch pricing (vendor): https://neon.com/faqs/free-plan-limits-and-quotas ; regions: https://neon.com/docs/introduction/regions
- Cloudflare Workers pricing and limits, R2 pricing, Durable Objects pricing, D1 limits (vendor): https://developers.cloudflare.com/workers/platform/pricing/ , https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/r2/pricing/ , https://developers.cloudflare.com/durable-objects/platform/pricing/ , https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare Universal SSL coverage: https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/
- Cloudflare free-plan rate limiting / WAF rules (secondary): https://eastondev.com/blog/en/posts/dev/20251201-cloudflare-pricing-compare/
- Railway plans and resource pricing (vendor): https://docs.railway.com/reference/pricing/plans
- Render free tier and paid prices (secondary): https://agentdeals.dev/vendor/render , https://www.budgetforge.dev/tools/render-pricing-2026
- Supabase free plan (secondary): https://uibakery.io/blog/supabase-pricing ; regions: https://supabase.com/docs/guides/platform/regions ; India block, Feb 2026: https://www.techcrunch.com/2026/02/27/india-disrupts-access-to-popular-developer-platform-supabase-with-blocking-order/
- Oracle Always Free A1 halving and reclaim policy: https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/ , https://www.mrplanb.com/datacenter/free-vps-tiers
- GitHub Student Developer Pack offers (vendor): https://education.github.com/pack ; DigitalOcean leaving the Pack: https://github.com/orgs/community/discussions/201240
- Azure for Students (secondary): https://creditforstartups.com/students/azure-for-students
- India latency benchmark (secondary): https://aiccloud.in/blog/india-cloud-latency-benchmark-2026
- Vultr / Lightsail / Linode / DigitalOcean list prices (secondary): https://costbench.com/software/cloud-infrastructure/vultr/ , https://cloudburn.io/blog/amazon-lightsail-pricing , https://bestusavps.com/reviews/linode/ , https://www.websiteplanet.com/blog/digitalocean-pricing-plans/
- Resend free tier (secondary): https://automationatlas.io/answers/resend-free-tier-explained-2026/
- Amazon SES pricing and free-tier change (secondary): https://smtpedia.com/amazon-aws-ses-pricing/ , https://www.saaspricepulse.com/tools/amazon-ses
- Zoho ZeptoMail pricing (secondary): https://www.saasworthy.com/product/zoho-zeptomail
- Postmark / Brevo free plans (secondary): https://costbench.com/software/email-api/postmark/free-plan/ , https://www.fastlancer.org/en/fastlancer-blog/brevo-review/
- Sentry Developer plan (secondary): https://costbench.com/software/developer-tools/sentry/free-plan/
- Better Stack free plan (secondary): https://onlineornot.com/uptime-monitoring-tools
- UptimeRobot free plan (secondary): https://notifier.so/guides/uptimerobot-pricing-2026/
- Healthchecks.io free plan (secondary): https://foursight.cloud/compare/healthchecks-pricing
- Grafana Cloud free tier (secondary): https://costbench.com/software/observability/grafana-cloud/free-plan/
- Backblaze B2 pricing (secondary): https://tech-insider.org/backblaze-b2-vs-wasabi-vs-s3-2026/
- Upstash free tier (vendor docs): https://upstash.com/docs/redis/overall/pricing
- GitHub Actions pricing 2026 (secondary): https://samexpert.com/github-actions-pricing-backlash-2026/
- Vercel Hobby limits (vendor): https://vercel.com/docs/plans/hobby
- Coolify / Kamal / Dokku resource needs (secondary): https://www.bitdoze.com/coolify-vs-dokploy-vs-kamal-2/
- Let's Encrypt 45-day timeline (vendor): https://letsencrypt.org/2025/12/02/from-90-to-45
- iOS PWA push requirements (secondary): https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications
- postgres:18 PGDATA change: https://aronschueler.de/blog/2025/10/30/fixing-postgres-18-docker-compose-startup/
- PostgreSQL 19 status (beta/RC as of late Sept 2026): https://jamsql.com/blog/whats-new-postgresql-19/
