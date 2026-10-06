# 08 · Integrations (client side)

> **Slice:** 08-integrations · **Date:** 2026-10-05 · **Status:** brainstorm proposal. Nothing here is locked until it lands in `JOURNEY.md`.
> **Covers:** the git post-commit hook, commit → task mapping, the `.planner` link file, session gap thresholds (as clients see them), the VS Code extension, the Claude Code integration (hooks, plugin, MCP), a shared client core/CLI, and a paragraph on the browser extension.
> **Does not cover:** the server-side session state machine (05), API style (03), token issuance (06). Where I depend on those, I say so in §2.

### Facts verified for this slice (checked 2026-10-05)

| Thing | What I verified | How |
|---|---|---|
| Git | Local `git version 2.55.0`. **Config-based hooks** (`hook.<name>.command` / `hook.<name>.event` / `hook.<name>.enabled`) exist since **Git 2.54**. They run in config-parse order, and the classic hook from the hooks dir runs last. `hook.<name>.enabled=false` in a repo's local config disables a globally defined hook. | `git-hook(1)` man page shipped with 2.55.0; GitHub blog "Highlights from Git 2.54" |
| Git hook behaviour | In a sandbox repo on 2.55.0: a global config-based `post-commit` hook **and** a husky-style repo-local `core.hooksPath=.husky` hook both fired (config hook first). `git -c core.hooksPath=/dev/null commit` silenced the husky hook but **not** the config hook. `--no-verify` does not skip `post-commit`. `--amend` fires `post-commit` (new SHA) and then `post-rewrite amend` with `old new` on stdin. `rebase` fires `post-commit` once per replayed commit with HEAD detached and `$GIT_DIR/rebase-merge` present, then one `post-rewrite rebase` listing every `old new` pair. `cherry-pick` fires `post-commit`. A clean `merge --no-ff` does **not** fire `post-commit`. | Hands-on test, output inspected |
| `core.hooksPath` | Replaces `$GIT_DIR/hooks` entirely. A relative value is resolved per repo. Husky v9 sets a repo-local `core.hooksPath`, which overrides a global one. | `git-config(1)` 2.55.0; husky 9.1.7 |
| Claude Code | Local `2.1.289`. Hook events include `SessionStart` (sources `startup|resume|clear|compact|fork`), `UserPromptSubmit`, `PostToolBatch`, `Stop`, `SessionEnd`, `Notification`, and others. Common stdin fields: `session_id`, `cwd`, `hook_event_name`, `transcript_path`, `prompt_id`. Exit 2 on `UserPromptSubmit` **rejects the prompt**. Plain (non-JSON) stdout on `UserPromptSubmit` is **added to Claude's context**. JSON `systemMessage` is shown to the user. `UserPromptSubmit` has a default timeout of 30 s. `SessionEnd` hooks share a 1.5 s budget. `async: true` hooks run in the background and **their timeout is not enforced**. Plugins carry `hooks/hooks.json`, `.mcp.json`, and `userConfig` options. A `sensitive: true` option goes to secure storage and reaches hook processes as `CLAUDE_PLUGIN_OPTION_<KEY>`, and MCP server `env` as `${user_config.KEY}`. | code.claude.com/docs/en/hooks, /plugins-reference, /mcp |
| MCP | Current spec **2026-07-28**. It is stateless: no `initialize` handshake and no `Mcp-Session-Id`, and it adds `server/discover`. Roots, Sampling, and Logging are deprecated. Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents. HTTP transports use OAuth 2.1 with RFC 9728 metadata. **stdio servers "SHOULD NOT" follow the OAuth flow and should take credentials from the environment.** | modelcontextprotocol.io spec + changelog |
| MCP TypeScript SDK | v2 is split into `@modelcontextprotocol/server` **2.3.1** and `@modelcontextprotocol/client` **2.3.1**, which implement 2026-07-28. Legacy `@modelcontextprotocol/sdk` is at 1.32.1. v2 examples use `serveStdio` and `registerTool` with `zod/v4` (zod **4.6.5**). | npm registry, ts.sdk.modelcontextprotocol.io/v2 |
| VS Code | Local Code OSS **1.138.0**. Its `product.json` points at the Microsoft Marketplace and `urlProtocol` is `vscode`. `@types/vscode` latest is 1.140.0. `WindowState.active` is documented as *"Whether the window has been interacted with recently. This will change immediately on activity, or after a short time of user inactivity."* `SecretStorage` persists to the OS credential store and is not synced. `@vscode/vsce` **4.0.0**, `ovsx` **1.2.0**, `@vscode/test-electron` **3.1.0**. | typings 1.138.0, local `product.json`, npm |
| Keyring | `gnome-keyring-daemon` (Secret Service) is running on Atif's Hyprland session, with libsecret 0.21.8. `@napi-rs/keyring` is at **2.1.0**. `keytar` 7.9.0 is old and unmaintained, so avoid it. | local process list, npm |
| Other libs | `smol-toml` 1.9.0, `vitest` 5.0.3, `esbuild` 0.28.2, `tsup` 8.5.1, Node **26.9.0** locally (global `fetch` and `AbortSignal.timeout` built in). | npm, local |

Not verified: whether `git reflog -1 --format=%gs` inside `post-commit` reliably tells a cherry-pick apart from a plain commit. A sandbox run to check it was blocked, so the design below avoids depending on it.

---

## 1. TL;DR

- **Build one TypeScript client core plus one `planner` CLI.** The CLI plays three roles: git hook flusher (`planner flush`), Claude Code hook handler (`planner cc hook`), and local stdio MCP server (`planner mcp`). The VS Code extension bundles the same core. **No daemon.** All clients share one on-disk **spool** (a maildir-style queue), and every event carries an **idempotency key**, so retries and double sends are harmless.
- **Install the git hook as a Git ≥ 2.54 config-based hook in `~/.gitconfig`** (`hook.planner.event = post-commit`, plus a second one for `post-rewrite`). It coexists with husky, lefthook, and pre-commit (verified). **Never set a global `core.hooksPath`.** The hook itself is a ~20-line POSIX `sh` shim. It writes one small file and maybe spawns one detached flusher, so a commit never waits on the network. Per-repo opt-out is `git config hook.planner.enabled false`.
- **Commit → task precedence:** `Planner-Task:` trailer → task token in the branch name (`feat/t42-…`) → the session already running in that project → `.planner` `default_task` → project-level "unsorted" → a global **inbox of unmatched commits**. Linking a repo from the inbox retroactively claims all its commits. Name matching only ever produces a *suggestion*.
- **`.planner` is a committed TOML file** holding an opaque project id (never the name), with optional `[[path]]` entries for monorepos. Personal links that should not be committed live in `~/.config/planner/links.toml` and win over the file. Forks with a foreign project id degrade to "unlinked" without errors.
- **Gap thresholds per source** (server-side settings, tunable per user): editor 15 min, Claude Code 20 min, commit-to-commit 60 min. A commit-only session is back-dated by a **learned allowance** (default 30 min, clamped to 10–90). It is never back-dated past the previous activity, and it is marked `inferred`. Rebases and cherry-picks are **metadata, not activity**.
- **VS Code:** status-bar timer, Start/Switch/Stop through a QuickPick task tree, and auto-match of the project from the folder. Heartbeats are one summary per 2-minute window, and only from focused, user-driven events. Tokens live in `SecretStorage` and come from a device-code login. Ship as a sideloaded `.vsix` first, then on Open VSX and the Marketplace.
- **Claude Code** gets a plugin. Its hooks handle the automatic parts: `UserPromptSubmit` "ensures" a session and notifies via `systemMessage` only when one was created, and `PostToolBatch`/`Stop` send throttled async heartbeats. Its **local stdio MCP server** handles the conversational parts (`next_task`, `log_note`, `capture`, `breakdown_dump_item`, …). Dump breakdown uses *the user's own Claude*, so it costs us zero LLM money (consistent with D-002).
- **One challenge to D-006:** once the CLI exists, the Claude Code *hooks* take about 2 days and the VS Code extension about 2–3 weeks. I suggest building Claude Code hooks right after the git hook, and keeping MCP after VS Code. See §8.

---

## 2. Assumptions about other slices

Each assumption is written so a critic can check it against the real slice.

**03 (API style).** I assume **REST + JSON over HTTPS**, versioned under `/v1`, at a base URL like `https://tasks.ahmedatif.in/api/v1` (configurable). The clients need these endpoints. Names are suggestions, but the semantics matter:

| Endpoint | Used by | Semantics I need |
|---|---|---|
| `POST /v1/ingest` | flusher, VS Code, Claude hooks | Batch of ≤ 100 events. Per-item result `accepted / duplicate / rejected`. HTTP 200 even if some items fail. Body carries `sentAt` so the server can correct client clock skew. |
| `POST /v1/sessions/ensure` | Claude hook, VS Code auto-start | "Start if nothing is running for me." Returns `{ session, created: boolean, conflict?: { session } }`. Takes an `Idempotency-Key` header. |
| `POST /v1/sessions` / `POST /v1/sessions/{id}/stop` / `PATCH /v1/sessions/{id}` | VS Code, MCP | Explicit start / stop / set task. Starting while another session runs → `409` with the running session in the body. |
| `GET /v1/sessions/current` | status bar, MCP, SessionStart hook | Running session (or `null`). |
| `GET /v1/projects`, `GET /v1/projects/{id}/tasks?status=open&shape=tree` | VS Code picker, MCP | Compact tree, ≤ 500 tasks. |
| `GET /v1/repo-links/{repoKey}` / `PUT /v1/repo-links/{repoKey}` | clients, inbox UI | Server-side repo → project links (made from the web inbox). |
| `POST /v1/tasks`, `PATCH /v1/tasks/{id}`, `POST /v1/sessions/{id}/notes`, `POST /v1/dump`, `GET /v1/dump` | MCP | Standard CRUD. |
| `GET /v1/suggestions/next-task?projectId=&minutes=` | MCP `next_task` | Owned by 10 (scheduling). I only call it. |

If 03 picks tRPC or GraphQL, the core's `ApiClient` interface hides it. The git flusher and hooks still need a plain-HTTP JSON endpoint for ingest, though, and tRPC's HTTP adapter is fine for that.

**05 (sessions and realtime).** I assume the server owns the session state machine and **accepts client-reported timestamps** (`occurredAt`), clamped (not more than 5 min in the future after skew correction, and not older than 14 days). I also assume it supports **inferred** sessions (created from commits or heartbeats, `confidence: low|high`) alongside explicit ones. Heartbeats only bump `last_seen` (D-009), and closing is computed lazily with **per-source gap thresholds from a per-user settings row** (numbers in §5.7). If 05 uses only server receive time, the offline queue produces wrong sessions. That would be a mismatch to fix.

**06 (auth and identity).** I assume **personal access tokens** (opaque, prefix `pln_`, hashed at rest) with scopes. The clients need `ingest:write`, `sessions:write`, `tasks:read`, `tasks:write`, and `dump:write`. I assume **one token per client per device** (e.g. "VS Code on rury"), each listed with `lastUsedAt` and revocable. I also assume a **device authorization grant** (RFC 8628 shape: `POST /v1/auth/device` → `user_code` + `verification_uri_complete`, then poll `POST /v1/auth/device/token`) so the CLI and VS Code can log in through the browser without a URI handler. A "create token" page in Settings with scope presets is the fallback. **Remote MCP over HTTP is not assumed for v3.** If it comes later, it needs 06 to run an OAuth 2.1 authorization server with RFC 9728 metadata, which is a big separate job.

**02 (data model).** I assume:
- ids are opaque strings (`prj_…`, `tsk_…`, `ses_…`).
- tasks also have a **short per-user number** (`t42`) for branch names and trailers.
- sessions have a `source` (`manual|git|vscode|claude_code|browser`) and an `inferred` flag.
- there is a `commit` table keyed by `(user_id, repo_key, sha)` with `superseded_by`.
- there is a `repo_link (user_id, repo_key) → project_id` table.

If 02 prefers per-project keys (`TASKS-42`), the branch regex in §5.5 changes and nothing else does.

**07 (infra).** I assume the API is on public HTTPS with a valid certificate, and that request size limits are at least 256 KB. 100 commit events with subjects is about 60 KB.

**10 / 11 / 12.** MCP `next_task` calls 10's suggestion endpoint. MCP `capture` posts raw text to 11's dump/quick-add endpoint, with parsing done server-side. 12 owns notification copy, the unmatched-commits inbox UI, and how inferred sessions look in the calendar. I only define the data.

---

## 3. Three genuinely different approaches

| Approach | Pros | Cons | Solo-dev effort | Interview value |
|---|---|---|---|---|
| **A. Per-tool thin clients.** `sh`+`curl` git hook, VS Code extension with its own HTTP code, shell-script Claude hooks, separate MCP package. | Each piece ships alone. The git hook has zero runtime dependencies. No up-front abstraction. | Offline queue, retry, idempotency, `.planner` parsing, and token storage get written **three times in two languages**. `curl` in `post-commit` risks blocking commits. Keyring access from `sh` is awkward, so tokens end up in plain files. Clients drift apart (one sends trailers, another doesn't). | First client ~2–3 days. Total ~5–6 weeks plus ongoing drift fixes. | Low to medium: "three scripts". |
| **B. Shared core + one `planner` CLI** (recommended). A tiny `sh` shim for git, and the same Node CLI as flusher, Claude hook handler and stdio MCP server. VS Code bundles the core. | One tested implementation of config, link resolution, spool, flush, auth. The synchronous git path stays tiny. Offline-safe by design. Same envelope everywhere. Clean monorepo story. | Needs Node on the machine. ~50–80 ms Node cold start for hook processes (only flusher and Claude hooks, never the commit path). Version skew between the global CLI and the core bundled in the `.vsix` (solved by a versioned envelope). | First client ~1.5× A. Total ~4 weeks part-time. | **High:** layered design, idempotent ingest, crash-safe queue, explicit trade-offs, real tests. |
| **C. Local daemon** (`plannerd` as a systemd user service). Clients talk to it over a Unix socket. It holds the token, queue, and current-session cache, and syncs to the server. | Instant local answers. One process owns all state. Can dedupe cross-source activity locally and hold a WebSocket to the server. Similar to ActivityWatch. | Lifecycle work (systemd/launchd/Windows), socket auth, upgrades, crash recovery. **If the daemon is down, data is lost unless clients also spool**, which means building B anyway. An easy interview question to fail: "why a daemon for one request every 2 minutes?" | ~6–8 weeks. Likely unfinished. | Sounds impressive, but hard to defend for this load. |
| **D. Server-side only.** GitHub webhooks / GitHub App on `push`. | Nothing to install. Works from any machine. HMAC-signed webhooks are a nice security talking point. | Sees **pushes, not commits**, often hours later. No start signals at all. GitHub-only. Needs an App install for private repos. Cannot deliver D-006's VS Code or Claude behaviours. | ~1 week. | Medium, but only as a complement. |

**A** is what most people build first, and it is the right choice if only the git hook will ever exist. The cost appears with the second client. Things like "retry with backoff, but never block, survive a crash between send and ack, never send the same commit twice" are hard to get right once in `sh`, and pointless to get right twice.

**B** keeps the one hard real-time constraint (a commit must not wait) in a 20-line shell script that does nothing but write a file. Everything that needs judgement (enrichment, privacy filtering, link resolution, batching, backoff) moves into one TypeScript codebase that can be unit-tested against real temporary git repos. The VS Code extension, being a long-lived process, flushes in-process with the same code. The Claude Code hooks and MCP server are just two more subcommands.

**C** solves problems this app doesn't have yet. D-009 already showed the load is tiny. The real value of a daemon (cross-source dedupe, instant local state) can be done server-side, because the server sees every source anyway.

**D** is worth keeping in the back pocket as a **backfill** for commits made on machines without the hook. It cannot be the main mechanism because it never sees work *starting*.

---

## 4. Recommendation

**Choose B: a `planner-core` TypeScript library plus a `planner` CLI, no daemon.** Concretely:

1. A **git shim** (`sh`, installed as a Git ≥ 2.54 config-based hook) captures `sha`, branch, operation and time into a spool file in a few milliseconds. It spawns `planner flush` detached only if no flusher is already running.
2. **`planner flush`** enriches spool entries with `git show`, applies privacy rules, resolves the link, and sends batches to `POST /v1/ingest` with idempotency keys. It deletes each file only after a `accepted` or `duplicate` answer.
3. **`planner cc hook`** reads Claude Code hook JSON on stdin. It works within a 1.5 s budget, falls back to the spool, always exits 0, and prints only JSON.
4. **`planner mcp`** is a stdio MCP server (SDK v2, spec 2026-07-28) shipped inside a **Claude Code plugin** together with the hooks.
5. The **VS Code extension** bundles `planner-core` with esbuild. It keeps tokens in `SecretStorage` and flushes in-process.

### The strongest argument against it

> "D-006 says the git hook is *tiny and tool-agnostic*, and that's the whole point of doing it first. A 60-line POSIX `sh` script with `curl --max-time 2`, run in the background, with an append-only queue file, is done in a weekend. It works on a KIIT lab PC or a remote server with no Node, no npm, no keyring. You're proposing a TypeScript monorepo, a CLI package, a spool format, and a lock protocol *before a second consumer exists*. That's premature abstraction. The VS Code extension is long-lived and uses `SecretStorage`, while hooks are short-lived and use a keyring, so the 'shared' core will grow two code paths anyway. And putting Node anywhere near git hooks invites PATH problems from GUI git clients and nvm shims. Build the shell script, live with it for a month, *then* extract what the second client actually needs."

This is a good argument, and part of it is adopted already: the synchronous path *is* a tiny shell script, and the spool file it writes is plain text that a `curl` fallback could read. Where it falls short is the hard 20% of the problem: idempotent retry, crash safety between send and delete, rebase floods, privacy filtering of messages, and correct handling of `post-rewrite`. That is exactly what the second and third clients also need, and it is exactly what is miserable to write and test in `sh`. Also, the "second consumer" is not hypothetical. D-006 already lists two more (VS Code, Claude Code), and the Claude Code hooks are short-lived processes just like the git flusher.

**When I would switch:**
- **To a `curl`-only flusher (a variant of A):** if Atif finds himself committing on machines without Node more than occasionally (lab PCs, servers). Add a `planner-lite` mode to the shim that sends the same envelope with `curl`, and keep the core for everything else.
- **To C (daemon):** if a fourth local source arrives that needs client-side cross-source dedupe (for example a terminal or desktop-app tracker emitting several events per second), or if profiling shows Node spawn cost from Claude `PostToolBatch` hooks above roughly one per second sustained.

---

## 5. Implementation walkthrough

### 5.1 Repository layout

```
integrations/                 (pnpm workspace, inside the main monorepo)
  packages/core/              planner-core: pure TS, no VS Code / no CLI deps
    src/config.ts paths.ts auth.ts repo.ts link.ts events.ts
        spool.ts flush.ts api.ts throttle.ts privacy.ts
  packages/cli/               `planner` bin (bundled to one .mjs with tsup)
    src/commands/{login,link,git,flush,status,doctor}.ts
    src/cc-hook.ts  src/mcp.ts
    shims/post-commit.sh  shims/post-rewrite.sh
  packages/vscode/            extension, bundles core with esbuild
  packages/claude-plugin/     .claude-plugin/plugin.json, hooks/hooks.json, .mcp.json, skills/
```

### 5.2 Local files

| Path (Linux, XDG) | Contents |
|---|---|
| `~/.config/planner/config.toml` | `api_url`, `privacy` default, `track.include` / `track.exclude` globs, notification prefs |
| `~/.config/planner/links.toml` | Personal path → project links (never committed). Also covers non-git folders. |
| `~/.local/state/planner/spool/{tmp,new,bad}/` | One file per event (maildir pattern: write to `tmp/`, `rename` into `new/`, which is atomic on the same filesystem) |
| `~/.local/state/planner/flush.lock` | `{pid, startedAt}`. Stale after 120 s. |
| `~/.local/state/planner/backoff.json`, `needs-login` | Retry state and auth failure marker |
| `~/.local/state/planner/device-id` | Random UUID generated once |
| OS keyring, service `planner`, account `<api host>:cli` | CLI token via `@napi-rs/keyring`. Fallback is `~/.config/planner/credentials` with mode 0600. `PLANNER_TOKEN` overrides both. |

### 5.3 Event envelope (shared by every client)

```ts
// packages/core/src/events.ts
export type Source = 'git' | 'vscode' | 'claude_code' | 'cli' | 'browser';

export interface RepoRef {
  repoKey: string;      // "rk_" + 16 hex of sha256(normalizedRemote), or "rr_" + oldest root commit sha
  remote?: string;      // "github.com/atif/tasks": userinfo stripped, lowercased host; omitted at privacy=hash-only
  rootSha?: string;     // cached in local git config `planner.rootsha` (computing it walks history once)
  dirName: string;      // basename of toplevel; for the inbox and name-match *suggestions*
}

export interface LinkHint {
  projectId?: string;
  via: 'local' | 'dotfile' | 'none';
  defaultTaskRef?: string;
  error?: 'malformed_dotfile' | 'foreign_project';
}

interface Base { v: 1; id: string; idempotencyKey: string; occurredAt: string; source: Source }

export interface CommitEvent extends Base {
  kind: 'commit';
  repo: RepoRef; link: LinkHint;
  sha: string; parents: string[];
  branch: string | null;                       // captured at commit time; rebase head-name if rebasing
  op: 'commit' | 'rebase' | 'merge' | 'unknown';
  authoredAt: string; committedAt: string; firedAt: string;
  subject?: string;                            // first line only; omitted at hash-only
  trailers: { plannerTask: string[] };         // values of `Planner-Task:`
  stats?: { files: number; insertions: number; deletions: number };
  touchedPrefixes?: string[];                  // only when .planner has [[path]] entries
}

export interface RewriteEvent extends Base {
  kind: 'rewrite'; repo: Pick<RepoRef, 'repoKey'>;
  op: 'amend' | 'rebase'; pairs: Array<{ from: string; to: string }>;
}

export interface HeartbeatEvent extends Base {
  kind: 'heartbeat';
  projectId?: string; repoKey?: string; taskId?: string; clientRef?: string; // e.g. Claude session_id
  windowStart: string; windowEnd: string; count: number;
  categories: Partial<Record<'edit'|'save'|'navigate'|'terminal'|'debug'|'prompt'|'agent', number>>;
}

export type PlannerEvent = CommitEvent | RewriteEvent | HeartbeatEvent;

export interface IngestBatch {
  sentAt: string;
  client: { name: string; version: string; deviceId: string };
  events: PlannerEvent[];
}
export interface IngestResult {
  results: Array<{ id: string; status: 'accepted' | 'duplicate' | 'rejected'; error?: string }>;
}
```

**Idempotency keys:**
- commit: `commit:{repoKey}:{sha}`
- rewrite: `rewrite:{repoKey}:{sha256 of sorted pairs}`
- heartbeat: `hb:{deviceId}:{source}:{windowStart}`
- Claude ensure: `ensure:cc:{session_id}`

The server stores keys for 30 days. A duplicate returns `duplicate`, and the client treats that as success.

Heartbeats deliberately carry **no file names and no languages**. They are "last seen" evidence (D-009), not a WakaTime clone.

### 5.4 The git hook

**Install (`planner git install`):**

```sh
# Git >= 2.54: global, coexists with husky/lefthook/pre-commit, per-repo opt-out possible
git config --global hook.planner.command "$HOME/.local/share/planner/shims/post-commit.sh"
git config --global --add hook.planner.event post-commit
git config --global hook.planner-rewrite.command "$HOME/.local/share/planner/shims/post-rewrite.sh"
git config --global --add hook.planner-rewrite.event post-rewrite
# opt one repo out:
git config hook.planner.enabled false && git config hook.planner-rewrite.enabled false
```

The installer copies the shims to a stable path and **bakes in the absolute path of the `planner` binary**. GUI git clients (including VS Code's Source Control panel) run hooks with a different `PATH`.

On **Git < 2.54**, `planner git install --repo` writes `.git/hooks/post-commit`. If a hook already exists there, it renames it to `post-commit.planner-chained` and calls it first. If the repo has its own `core.hooksPath` (husky), the installer **refuses to edit tracked files**. It prints the one line to add to `.husky/post-commit` instead. It never sets a global `core.hooksPath`.

**The shim** must never fail, block or print:

```sh
#!/bin/sh
# planner post-commit shim. Installed by `planner git install`. Must never fail, block or print.
[ -n "$PLANNER_DISABLE" ] && exit 0
PLANNER_BIN="__PLANNER_BIN__"                       # absolute path baked in at install
state="${XDG_STATE_HOME:-$HOME/.local/state}/planner"
spool="$state/spool"
mkdir -p "$spool/tmp" "$spool/new" 2>/dev/null || exit 0
sha=$(git rev-parse HEAD 2>/dev/null) || exit 0
gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0
branch=$(git symbolic-ref -q --short HEAD 2>/dev/null)
op=commit
if [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ]; then
  op=rebase
  [ -z "$branch" ] && branch=$(sed 's#^refs/heads/##' "$gitdir/rebase-merge/head-name" 2>/dev/null)
fi
f="$(date +%s)-commit-$sha"
printf 'v=1\nkind=commit\nsha=%s\nop=%s\nbranch=%s\nfired_at=%s\ntoplevel=%s\n' \
  "$sha" "$op" "$branch" "$(date +%s)" "$(git rev-parse --show-toplevel 2>/dev/null)" \
  > "$spool/tmp/$f" 2>/dev/null && mv -f "$spool/tmp/$f" "$spool/new/$f" 2>/dev/null
# One detached flusher at a time. Fully detach stdio, or git and IDEs wait on the open pipe.
if [ ! -e "$state/flush.lock" ] && [ -x "$PLANNER_BIN" ]; then
  ( "$PLANNER_BIN" flush --quiet --delay 3 </dev/null >/dev/null 2>&1 & ) 2>/dev/null
fi
exit 0
```

**Privacy filtering does not happen in the shim.** The shim records only a SHA and the branch, locally. The flusher decides whether anything leaves the machine.

`post-rewrite.sh` is the same pattern. It writes `kind=rewrite`, `op=$1`, then copies stdin (`old new` lines) verbatim.

**The flusher:**

```ts
// packages/core/src/flush.ts
export interface FlushOptions { delayMs?: number; deadlineMs?: number; maxBatches?: number }
export type FlushResult =
  | { sent: number; duplicates: number; rejected: number; remaining: number }
  | { skipped: 'locked' | 'backoff' | 'needs-login' | 'disabled' };

export async function flush(ctx: CoreContext, opts: FlushOptions = {}): Promise<FlushResult>;

// Algorithm
// 1. acquireLock(flush.lock, stale=120s) or return {skipped:'locked'}
// 2. sleep(delayMs)                  -> coalesces rebase bursts and lets post-rewrite land
// 3. if backoff.until > now          -> return {skipped:'backoff'}
// 4. loop: files = spool.oldest(100)
//      events = enrich(files)        -> git show (with GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE scrubbed
//                                       from env), privacy filter, link resolution, include/exclude
//                                       globs (excluded -> delete file, nothing sent)
//      res = api.ingest(batch, timeout 10s)
//      accepted|duplicate -> unlink file ; rejected -> move to bad/ with reason
//      network/5xx/429 -> backoff (1s,2s,4s… cap 1h, full jitter; honour Retry-After) and stop
//      401 -> write needs-login marker, stop (spool kept)
// 5. release lock; if new/ gained files during the run, loop once more (closes the lock race)
```

Enrichment runs a single `git -C <toplevel> show -s --format=%H%x00%P%x00%aI%x00%cI%x00%s%x00%(trailers:key=Planner-Task,valueonly,separator=%x1f) <sha>`, plus `git diff-tree --no-commit-id --shortstat -r <sha>`. For merge commits it uses `--first-parent`. If the repo is gone by flush time (a temp clone was deleted), the flusher sends a minimal event with SHA, branch and times.

**Classifying activity (client marks, server decides).** The server uses `committedAt` as the activity time. Exceptions:
- `op=rebase`: metadata only. The replayed commits were not new work.
- A commit with `committedAt − authoredAt > 10 min` and no matching `amend` rewrite pair: treated as cherry-pick-like, so metadata only.
- An **amend** keeps the original author date but has a fresh committer date. Its `rewrite amend` pair arrives within the 3 s flush delay, so the server knows it was real work.
- Merge commits with conflict resolution (`parents.length > 1` from a manual `git commit`) count as activity.

**Rewrites on the server (05's job, specified here for completeness).** For each `{from, to}`: if `from` is known, set `superseded_by = to`. Move `from`'s task link to `to` unless `to` has its own trailer. Hide `from` in session commit lists. Session durations do not change.

**Privacy levels**, set in `config.toml` and overridable per repo in `links.toml`:

| Level | Sent |
|---|---|
| `full` | subject, trailers, stats, normalized remote |
| `subject` (**default**) | as `full`, but body never sent (it isn't in `full` either; the body is never sent) |
| `hash-only` | sha, times, branch, repoKey, trailers. No subject, no remote. |

Nothing is sent at all for repos that are neither linked nor matched by `track.include`. The installer asks once ("Which folders hold your code? [~/programming]"). For Atif, the default `include = ["~/programming/**"]` captures everything without catching AUR build clones or dotfile repos.

### 5.5 Commit → task mapping (§7 open question)

Resolution runs **on the server**, because it needs tasks and sessions. The client only extracts the evidence. Precedence, first match wins:

1. **Trailer** `Planner-Task: t42` (or a full `tsk_…` id) in the commit message. It is explicit, per commit, survives rebase and cherry-pick, and shows up in `git log`. Several trailers link the commit to several tasks, and the first one gets the time.
2. **Branch token.** The regex `(?:^|[/_-])t(\d{1,6})(?=$|[/_-])` is matched against the branch at commit time (during a rebase, the `head-name`). This fits Atif's own `<type>/<short-kebab-topic>` convention, e.g. `feat/t42-recurrence-engine`. **It requires the `t` prefix**, so `fix/404-page` and `release/2026-10` never match. The task must belong to the resolved project. A `t42` from another project is ignored unless a full id is used.
3. **The running session's task.** If a session (manual, VS Code or Claude) is running in the same project when the commit happens, use its task.
4. **`.planner` `default_task`** (for repos that *are* one task, like a lab assignment).
5. **Project resolved, no task** → the commit attaches to an inferred session with `task = null`. It shows in the project under "Unsorted", with a one-tap "assign".
6. **No project** (tracked repo, not linked) → the **Unmatched commits inbox**, grouped by repo. One action, "Link `github.com/atif/tasks` to project…", creates a `repo_link` and **retroactively claims every commit with that `repoKey`**. Name similarity between `dirName` and project names only pre-selects a suggestion. It is never auto-assigned.

If the trailer and the branch disagree, the trailer wins and the server stores `mapping_note: 'trailer_overrode_branch'` so the UI can show it.

A small helper is worth having: `planner task use t42` writes `Planner-Task: t42` into a repo-local `commit.template`, and `planner task clear` removes it. That is cheaper than retyping trailers, and it avoids a `prepare-commit-msg` hook (a second hook to maintain).

### 5.6 The `.planner` link file (risk §5, Open)

**Format: TOML.** It allows comments, it is hand-editable, it is familiar from Cargo and pyproject, and it avoids YAML's implicit-typing footguns. JSON has no comments. Parse it with `smol-toml` 1.9.0 and validate with zod.

```toml
# .planner: links this repository to a Planner project.
# Safe to commit: contains an opaque id, no secrets. Docs: https://tasks.ahmedatif.in/docs/link
version = 1
project = "prj_01JB3K9V7Q2M"        # identity. Never matched by name.
name = "tasks"                       # display only; also used for suggestions if the id is foreign
server = "https://tasks.ahmedatif.in" # optional: which Planner instance this id belongs to
# default_task = "t42"               # optional

# Monorepos: longest matching prefix wins; unmatched paths fall back to `project`.
[[path]]
prefix = "integrations/packages/vscode"
project = "prj_01JB3KA0VSC0"
```

**Resolution order** (`resolveLink(cwd)`):
1. `~/.config/planner/links.toml`, longest absolute-path prefix. Personal, and wins over everything else.
2. `.planner` found by walking up from `cwd`. Stop at the git toplevel, or at `$HOME` for non-git folders.
3. A server-side `repo_link` for the `repoKey` (made from the inbox), cached for 24 h.
4. None.

For a commit in a monorepo, the project is the `[[path]]` entry with the most changed files. Ties and unmatched files go to the root project. For VS Code and Claude, the active file path or `cwd` decides.

**Committed or gitignored?** It is committed by default for your own repos. It holds no secret, it follows the repo to the laptop and the lab PC, and seeing it in the tree reminds you the link exists. For repos you don't own (an open-source contribution, a team repo), `planner link --local` writes to `links.toml` instead, so nothing touches the repo.

| Situation | Behaviour |
|---|---|
| **Project renamed** | Nothing happens. Identity is the id, and `name` is cosmetic (`planner link --refresh` updates it). |
| **Folder renamed or moved** | Nothing happens for `.planner`. Local links are path-keyed, so `planner doctor` flags dangling paths and offers to re-point them. |
| **Remote renamed** (GitHub repo rename) | `repoKey` changes. The commit still carries `link.projectId` from the file, and the server sees the same `rootSha` under a new `repoKey`, so it migrates the `repo_link` and records a note. |
| **Fork or clone by someone else** | Their client asks the server about `prj_…`. A `404` or `403` sets `error: 'foreign_project'`, cached for 24 h. Events are sent with `repoKey` only and land in *their* inbox. VS Code shows "Link folder" instead of an error. No one learns anything about Atif's project except that the id exists in the file. |
| **Project archived or deleted** | The API answers `project_archived`. Warn once, then route to the inbox. |
| **Malformed file** | The hook still exits 0. The event carries `link.error = 'malformed_dotfile'` and `planner doctor` prints the parse error with a line number. |

### 5.7 Session gap thresholds and back-dating (§7 open question)

The client only sends raw signal times. **Thresholds live server-side in a per-user `session_policy`**, so they can be tuned without shipping clients. The defaults:

| Source | Signal | Gap that closes a session | Back-date | Reasoning |
|---|---|---|---|---|
| VS Code | one heartbeat per active 2-min window | **15 min** | none (start is observed) | Reading docs or a browser tab between edits is still work. 15 min is WakaTime's long-tested default "keystroke timeout". Longer gaps are usually breaks. |
| Claude Code | prompt, tool batch, stop | **20 min** | none | A prompt can trigger a 5–15 min agent run, followed by reading the diff. The gaps between prompts are longer than between keystrokes. |
| git (commit-only sessions) | commit | **60 min** between commits | **learned allowance**, default 30 min, clamped 10–90 | Commits are sparse. A 50-min gap between commits is usually continuous work, including terminal time no editor sees. |
| Manual timer | start/stop | none (explicit) | n/a | Explicit beats inferred. Auto signals attach to it. |
| Browser (future) | focus on a linked URL | 10 min | none | Cheap signal, easily left open, so it should be stricter. |

A session closes when `now − last_seen > gap(source of the last signal)`, computed lazily (D-009). Using "the gap of the last signal's source" is simple to explain and does the right thing for mixed sessions.

**Back-dating commit-only sessions** (risk §5: commits mark the *end*):

```
start = max( firstCommit.committedAt − allowance,
             previousActivityEnd(user) + 1 min,     // never overlap earlier evidence, any source
             firstCommit.committedAt − 90 min )      // hard cap
end   = lastCommit.committedAt
inferred = true, confidence = 'low' (dashed border in the calendar; 12's call)
```

If any live signal (VS Code or Claude) falls inside `[start, firstCommit]`, the start snaps to the earliest such signal and confidence becomes `high`.

**Learning the allowance.** For sessions where the true start *was* observed (explicit, VS Code or Claude) and that contain commits, record `firstCommit − start`. The allowance becomes the median of the last 30 observations, clamped to 10–90 min. This is the same idea as the estimation multiplier in JOURNEY session 2: the system learns your personal "how long before I first commit" from data it already has.

**Junk filter.** An inferred session with a single signal and a duration under 5 minutes is stored but hidden, unless it has a commit or is confirmed in the evening shutdown. This stops a one-line "what does this regex do?" prompt from creating a session.

### 5.8 VS Code extension

**Activation:** `onStartupFinished`, plus `workspaceContains:.planner`. The extension also needs `extensionKind: ["workspace"]` so that in Remote-SSH or WSL it runs where the files and git are.

**Commands:** `planner.start`, `planner.switchTask`, `planner.stop`, `planner.signIn`, `planner.signOut`, `planner.linkFolder`, `planner.openWeb`.

**Settings:** `planner.apiUrl`, `planner.autoTrack` (`"inferred"` default | `"prompt"` | `"off"`), `planner.heartbeats.enabled`.

```ts
export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const core = createCore({ clientName: 'planner-vscode', tokens: new SecretTokenStore(ctx.secrets) });
  const links = new FolderLinkCache(core);            // resolveLink per workspace folder, watches .planner
  const status = new StatusBarController(core, links); // createStatusBarItem(StatusBarAlignment.Left, 100)
  const tracker = new ActivityTracker(core, links, { windowMs: 120_000 });
  ctx.subscriptions.push(
    vscode.commands.registerCommand('planner.start', () => startFlow(core, links, status)),
    vscode.commands.registerCommand('planner.stop', () => stopFlow(core, status)),
    vscode.commands.registerCommand('planner.signIn', () => deviceLogin(core)),
    vscode.workspace.onDidChangeTextDocument(e => tracker.onEdit(e)),
    vscode.workspace.onDidSaveTextDocument(d => tracker.mark('save', d.uri)),
    vscode.window.onDidChangeActiveTextEditor(ed => ed && tracker.mark('navigate', ed.document.uri)),
    vscode.window.onDidChangeTextEditorSelection(e => tracker.onSelection(e)),
    vscode.window.onDidStartTerminalShellExecution(() => tracker.mark('terminal')),
    vscode.debug.onDidStartDebugSession(() => tracker.mark('debug')),
    vscode.window.onDidChangeWindowState(s => tracker.onWindowState(s)),
    status, tracker, links,
  );
}
```

**What counts as activity:**
- Text edits with at least one content change, on `file` or `vscode-remote` URIs, inside a linked folder.
- Saves.
- Switching the active editor.
- Selection changes whose `kind` is Keyboard or Mouse (`Command` is excluded, because programmatic moves don't count). Reading code is work.
- Starting a shell execution in the integrated terminal.
- Starting a debug session.

**Every mark is gated on `vscode.window.state.focused`.** That filters out programmatic edits: a background `git pull` rewriting open files, formatters running in an unfocused window, settings sync. Mark at most once per second.

**Batching (D-009):** the tracker keeps one bucket `{projectKey, firstAt, lastAt, count, categories}`. Every 120 s, a non-empty bucket becomes one `HeartbeatEvent`, goes to the spool, and is flushed in-process. Empty windows send nothing; that is the "only while active" rule. When `WindowState` loses focus, close the bucket early. `state.active` going false (VS Code's own short inactivity timer) needs no special handling, because no marks arrive.

**What a heartbeat does with no session:** with `autoTrack: "inferred"`, the server creates or extends an inferred session for the project (the same model as commits and Claude). The **Start button upgrades** it to an explicit session with a task. With `"prompt"`, after 3 active windows without a session the extension shows a non-modal notification: "Working on *tasks*? [Start] [Not now]".

**Status bar** (one item, left side):

| State | Shown | Click |
|---|---|---|
| Not signed in | `$(account) Planner: Sign in` | device login |
| Unlinked folder | `$(link) Link folder` | link flow |
| Linked, no session | `$(play) Start · tasks` | start flow |
| Running | `$(clock) 1:05 · t42 Recurrence eng…` (tooltip shows the full title, session source, and "inferred" if so) | QuickPick: Switch task / Stop / Add note / Open in web |

It refreshes every 15 s locally from `startedAt`, adjusted by a clock offset taken from the API's `Date` header. It re-fetches `GET /v1/sessions/current` every 60 s and after its own actions. No WebSocket is needed: minutes of staleness are fine (D-009). An SSE subscription from 05 could replace the polling later.

**Start flow:**
1. Resolve the project for the active editor's folder. If there is none, offer "Link this folder" (pick a project, then choose "write `.planner`" or "link locally").
2. QuickPick of open tasks, with the tree flattened under `QuickPickItemKind.Separator` headers per parent ("Backend › Calendar"). Each row shows `t42 · Recurrence engine` with its estimate and time spent. Extra rows: "No specific task" and "+ New task…" (an inline input box that calls `POST /v1/tasks`). The tree is cached for 5 minutes.
3. `POST /v1/sessions {projectId, taskId, source:'vscode'}` with an `Idempotency-Key` header. On `409`, ask "A session on *X* is running. Switch to this?"

**Auth:** `planner.signIn` calls `POST /v1/auth/device`, opens `verification_uri_complete` with `env.openExternal`, polls for the token, and stores it at `context.secrets` key `planner.token:<apiHost>`. The token is a PAT named "VS Code on <hostname>" with scopes `ingest:write sessions:write tasks:read tasks:write`. The device flow avoids `registerUriHandler`, whose scheme differs between VS Code, Code OSS, VSCodium and Cursor, and which is awkward over Remote-SSH. A full `AuthenticationProvider` would also work, but it adds ceremony with no benefit for a single-provider extension. Defer it.

**Packaging:** bundle with esbuild 0.28 to `dist/extension.js` with `vscode` external, then `vsce package` (@vscode/vsce 4.0.0) and `code --install-extension planner-0.1.0.vsix`. **Pin `@types/vscode` to the `engines.vscode` minimum** (e.g. `~1.100` if every API used exists there; check `WindowState.active` and `onDidStartTerminalShellExecution` against that version's typings). Do not use 1.140: Atif's Code OSS is 1.138 and would refuse the extension. Publish once v3 has been dogfooded for two weeks:
- **Open VSX** via `ovsx` 1.2.0: Eclipse account, Publisher Agreement, `ovsx create-namespace`, `ovsx publish -p`. Users of VSCodium, Cursor and stock Code-OSS builds get it from here.
- **Marketplace** via `vsce publish`: publisher plus Azure DevOps PAT. Atif's own build points at the Marketplace (checked in `product.json`), so either works for him.

### 5.9 Claude Code integration

**Hooks vs MCP vs plugin: what each is for**

| Mechanism | Good for | Not good for |
|---|---|---|
| **Hooks** (command type, `planner cc hook`) | Automatic, model-independent side effects: auto-start, heartbeats, injecting a few lines of context. They run whether or not Claude "decides" to. | Anything conversational. They can't ask questions or return rich data. |
| **MCP server** (stdio, `planner mcp`) | Things the *user asks for in words*: "what's my next task?", "log this", "break down this dump item", "start t42". | Automatic tracking. The model may or may not call a tool, and that's the wrong place for a timer. |
| **Plugin** | **Packaging** both, plus a skill or two, behind one install and one secure token prompt (`userConfig.api_token`, `sensitive: true`). | Nothing. It's the delivery vehicle. |

**`packages/claude-plugin/.claude-plugin/plugin.json`:**

```json
{
  "name": "planner",
  "displayName": "Planner",
  "version": "0.1.0",
  "description": "Auto-start Planner sessions from Claude Code and manage tasks by asking.",
  "author": { "name": "Atif Ahmed", "url": "https://ahmedatif.in" },
  "userConfig": {
    "api_token": { "type": "string", "title": "Planner token", "description": "Create one at Settings > Tokens (preset: Claude Code).", "sensitive": true },
    "notify": { "type": "string", "title": "Notifications", "description": "How to tell you a session started", "options": ["message", "message+desktop", "off"], "default": "message" }
  }
}
```

**`hooks/hooks.json`** (exec form: `command` is resolved on PATH and `args` are passed verbatim):

```json
{
  "hooks": {
    "SessionStart":     [{ "matcher": "startup|resume", "hooks": [{ "type": "command", "command": "planner", "args": ["cc", "hook"], "timeout": 5 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "planner", "args": ["cc", "hook"], "timeout": 4 }] }],
    "PostToolBatch":    [{ "hooks": [{ "type": "command", "command": "planner", "args": ["cc", "hook"], "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "planner", "args": ["cc", "hook"], "async": true }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "planner", "args": ["cc", "hook", "--spool-only"], "timeout": 2 }] }]
  }
}
```

**`.mcp.json`** (stdio). The project dir is passed explicitly, because Roots are deprecated in 2026-07-28:

```json
{ "mcpServers": { "planner": {
  "command": "planner",
  "args": ["mcp", "--cwd", "${CLAUDE_PROJECT_DIR}"],
  "env": { "PLANNER_TOKEN": "${user_config.api_token}" }
} } }
```

**Hook handler.** It *always* exits 0 and prints only JSON (or nothing). Exit 2 would reject the user's prompt, and plain stdout would leak into Claude's context.

```ts
// packages/cli/src/cc-hook.ts
type HookOut = { systemMessage?: string; terminalSequence?: string;
                 hookSpecificOutput?: { hookEventName: string; additionalContext?: string } };

export async function ccHook(stdin: string, flags: { spoolOnly?: boolean }): Promise<HookOut | null> {
  const input = HookInput.safeParse(JSON.parse(stdin));            // zod; on failure -> null
  if (!input.success || process.env.PLANNER_DISABLE) return null;
  const { hook_event_name: ev, session_id, cwd } = input.data;
  const link = await resolveLinkCached(cwd, session_id);            // cached in state/cc/<session_id>.json
  if (!link.projectId) return null;                                 // ~ or unlinked folders: silent
  switch (ev) {
    case 'SessionStart':     return sessionContext(link, { budgetMs: 1000 }); // additionalContext only
    case 'UserPromptSubmit': return ensureAndBeat(input.data, link, { budgetMs: 1500 });
    case 'PostToolBatch':
    case 'Stop':             await beat(input.data, link, 'agent', { throttleMs: 120_000, deadlineMs: 5000 }); return null;
    case 'SessionEnd':       await beat(input.data, link, 'agent', { spoolOnly: true }); return null;
    default:                 return null;
  }
}
```

`ensureAndBeat` behaves as follows:
- **First prompt** of this Claude `session_id` (no `ensured` flag in local state): `POST /v1/sessions/ensure {projectId, source:'claude_code', clientRef: session_id}` with `Idempotency-Key: ensure:cc:<session_id>`, under an `AbortSignal.timeout(1500)`.
  - `created: true` → `{"systemMessage": "Planner: started a session on 'tasks' (no task yet). Ask \"set my planner task to t42\" to pick one."}`. With `notify = message+desktop`, also add an OSC 777 `terminalSequence`.
  - `created: false`, same project → silent (it attached to the running session).
  - `conflict` (a session for another project is running) → `systemMessage: "Planner: a session on 'other' is running. Not switching."` Never auto-switch.
  - Timeout or offline → spool the ensure as a heartbeat with `categories.prompt = 1`. The server treats the first heartbeat of an unknown `clientRef` like an ensure. Show "Planner: offline, this session will be recorded later" once per Claude session.
- **Later prompts:** a heartbeat through the spool, throttled to one per 2 minutes using a state file's mtime. No message.

`SessionStart` never starts a session (D-006 says *first prompt*). It only returns about 300 characters of `additionalContext`, e.g. "Planner: this folder is project *tasks*. Running session: t42 Recurrence engine (0:42). Planner MCP tools are available for notes and next task." That lets Claude naturally say "I'll log that to t42" when asked.

Agent time counts. Prompt, tool-batch and stop heartbeats all extend the session, under the 20-min Claude gap. A 40-minute autonomous run the user walked away from still ends 20 minutes after the last `Stop`. That is an open decision (§9).

**MCP tools** (registered in a deterministic order as the spec now recommends, with compact `structuredContent` and a one-line text summary):

| Tool | Input | Does | Hints |
|---|---|---|---|
| `planner_status` | `{}` | Current session, resolved project, minutes until the next calendar block | read-only |
| `next_task` | `{ projectId?, minutes? }` | Calls 10's ranking for the free time before the next block | read-only |
| `list_tasks` | `{ projectId?, query?, status?: 'open'\|'all' }` | Compact tree (≤ 60 rows) | read-only |
| `start_session` | `{ taskRef?, projectId? }` | Start, or switch the running session's task | write |
| `stop_session` | `{ note? }` | Stop the running session | write |
| `log_note` | `{ text, commitSha? }` | Append a note to the running session ("log this") | write |
| `create_task` | `{ title, projectId?, parentRef?, estimateMinutes? }` | Add a task | write |
| `capture` | `{ text, projectId? }` | Thought dump (11 parses it) | write |
| `list_dump` | `{ projectId?, limit?: number }` | Unprocessed dump items | read-only |
| `breakdown_dump_item` | `{ dumpItemId, projectId, subtasks: {title, estimateMinutes?}[] (1–20), archiveItem?: boolean }` | Persist a breakdown that **Claude itself wrote**, after showing it to the user | write |

That is 10 tools. Claude Code's deferred tool search keeps their context cost low. Do not rely on MCP *prompts* for slash-style entry points. Put a `skills/breakdown/SKILL.md` in the plugin instead ("read the item with `list_dump`, propose 3–8 subtasks with estimates, ask for confirmation, then call `breakdown_dump_item`").

```ts
// packages/cli/src/mcp.ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

export function runMcp(cwd: string) {
  serveStdio(() => {
    const core = createCore({ clientName: 'planner-claude', cwd });   // token from PLANNER_TOKEN, else keyring
    const server = new McpServer({ name: 'planner', version: VERSION });
    server.registerTool('next_task', {
      description: 'Suggest what to work on next in this project, fitted to the free time before the next calendar block.',
      inputSchema: z.object({ projectId: z.string().optional(), minutes: z.number().int().min(5).max(480).optional() }),
      annotations: { readOnlyHint: true },
    }, async (args) => toResult(await core.api.nextTask(await core.scope(args))));
    server.registerTool('breakdown_dump_item', {
      description: 'Save subtasks for a thought-dump item. Only call after the user approved the list.',
      inputSchema: z.object({
        dumpItemId: z.string(), projectId: z.string(),
        subtasks: z.array(z.object({ title: z.string().min(1).max(200),
                                     estimateMinutes: z.number().int().positive().max(960).optional() })).min(1).max(20),
        archiveItem: z.boolean().default(true),
      }),
    }, async (args) => toResult(await core.api.breakdownDump(args)));
    // ... remaining tools
    return server;
  });
}
// toResult(): API errors become { isError: true, content: [{type:'text', text:'Not signed in: run `planner login`'}] },
// so Claude can explain them. They are never thrown as protocol errors.
```

MCP writes are **online-only** with clear errors. Claude needs to know whether it worked, so these do not go through the spool.

**Distribution:** a public GitHub repo, `atif/planner-claude`, with `.claude-plugin/marketplace.json`. Install with `/plugin marketplace add atif/planner-claude`, then `/plugin install planner@planner-claude`. The plugin needs the `planner` CLI on `PATH` (`npm i -g @ahmedatif/planner`). `planner doctor` checks for it, and a missing CLI produces exactly one `systemMessage` per session.

### 5.10 Shared core: key functions

```ts
// config.ts
export function loadConfig(env?: NodeJS.ProcessEnv): Promise<Config>;      // TOML + env overrides
// auth.ts
export interface TokenStore { get(): Promise<string | null>; set(t: string): Promise<void>; clear(): Promise<void> }
export function keyringTokenStore(account: string): TokenStore;              // @napi-rs/keyring, file fallback 0600
export function deviceLogin(api: ApiClient, opts: { clientLabel: string; scopes: string[];
  open(url: string): Promise<void>; onCode(code: string): void }): Promise<string>;
// repo.ts
export function findRepo(cwd: string): Promise<RepoInfo | null>;            // rev-parse with scrubbed GIT_* env
export function normalizeRemote(url: string): string;                       // strips userinfo, .git, scheme; lowercases host
export function repoKeyOf(info: RepoInfo): string;
// link.ts
export function parsePlannerFile(text: string): PlannerFile;                // throws LinkParseError(line, msg)
export function resolveLink(cwd: string, opts?: { filePath?: string }): Promise<LinkHint & { root?: string }>;
// spool.ts
export function enqueue(evt: PlannerEvent | RawStub): Promise<void>;        // tmp/ -> rename -> new/
export function oldest(n: number): Promise<SpoolEntry[]>;
export function ack(e: SpoolEntry): Promise<void>; export function quarantine(e: SpoolEntry, why: string): Promise<void>;
export function enforceBounds(): Promise<void>; // >10k files or >20 MB: drop oldest heartbeats; never commits/rewrites
// api.ts
export function createApi(baseUrl: string, tokens: TokenStore, client: ClientInfo): ApiClient; // fetch + AbortSignal.timeout
// throttle.ts
export function due(key: string, intervalMs: number): Promise<boolean>;     // mtime of state/throttle/<key>
```

### 5.11 How each client talks to the API

| Client | Transport | Main endpoints | Token | Stored at |
|---|---|---|---|---|
| git shim + `planner flush` | HTTPS REST | `POST /v1/ingest` | PAT "CLI on <host>": `ingest:write` (+ `tasks:read` for `planner link`) | OS keyring `planner/<host>:cli`; fallback `~/.config/planner/credentials` (0600); env `PLANNER_TOKEN` |
| VS Code | HTTPS REST | ingest, sessions/*, projects, tasks | PAT "VS Code on <host>": `ingest:write sessions:write tasks:read tasks:write` | `context.secrets` (libsecret / gnome-keyring on Linux) |
| Claude hooks (`planner cc hook`) | HTTPS REST | `sessions/ensure`, `sessions/current`, ingest | PAT "Claude Code on <host>": `ingest:write sessions:write tasks:read` | Plugin `userConfig.api_token` (Claude Code secure storage), seen as `CLAUDE_PLUGIN_OPTION_API_TOKEN`; else the CLI keyring |
| MCP (`planner mcp`) | stdio JSON-RPC to Claude Code; HTTPS REST to the API | tasks, dump, sessions, suggestions | same as the Claude hooks, plus `tasks:write dump:write` | `PLANNER_TOKEN` from `${user_config.api_token}` (the spec says stdio servers get credentials from the environment) |
| Browser extension (future) | HTTPS REST | ingest | PAT or OAuth PKCE (06) | `chrome.storage.local` (not secret-grade; use a narrow scope) |

### 5.12 Browser extension (far future)

A Manifest V3 extension would send `heartbeat` events with `source: 'browser'` when the focused tab's URL matches a per-project allowlist. Examples: the project's GitHub repo, its docs, its deployed preview on `*.ahmedatif.in`. It would use the same envelope and the same `POST /v1/ingest`, but no spool. It would keep a small `chrome.storage` queue, because it can't reach the CLI's files without native messaging. The 10-minute gap reflects how easily tabs are left open. It must never record URLs outside the allowlist. Its real value is filling the "reading docs" gap between editor heartbeats, and that is modest. It belongs after native widgets (D-007).

### 5.13 Order of work (follows D-006; see §8 for a proposed swap)

| Step | Scope | Rough effort (focused days) |
|---|---|---|
| v3a.1 | `planner-core`: config, paths, repo, link, spool, flush, api, keyring; vitest against temp repos and a fake HTTP server | 5 |
| v3a.2 | CLI: `login`, `link`, `git install/uninstall/off/on`, `flush`, `status`, `doctor`; shims; Git < 2.54 fallback | 3 |
| v3a.3 | Dogfood 2 weeks; tune gap and allowance defaults with real data | — |
| v3b.1 | VS Code: auth, status bar, start flow, task picker | 5 |
| v3b.2 | VS Code: activity tracker, heartbeats, autoTrack modes; `@vscode/test-electron` smoke test | 4 |
| v3c.1 | Claude plugin: hooks (`cc hook`), userConfig, marketplace repo | 2 |
| v3c.2 | `planner mcp`: 10 tools, breakdown skill, MCP client-based tests | 4 |
| v3d | Publish: npm, Open VSX, Marketplace; README with GIFs for the portfolio | 2 |

Total is about 25 focused days, which is realistic across a semester of evenings.

---

## 6. Traps (look cool, eat weeks)

1. **Global `core.hooksPath`.** It silently disables every repo's `.git/hooks`, including what pre-commit and lefthook install. Husky repos override it with a local `core.hooksPath`, so *your* hook silently never runs there. Use config-based hooks.
2. **Backgrounding with inherited stdio.** `planner flush &` without `</dev/null >/dev/null 2>&1` keeps a pipe open, and git, VS Code's Source Control panel, or lazygit waits for it. That is a "commits got slow" bug that's hard to trace.
3. **Spawning Node per commit.** A 200-commit rebase means 200 Node processes. The shim writes files, and one locked flusher drains them.
4. **Counting rebases and cherry-picks as work.** A morning `git rebase main` of 30 commits would invent a 30-commit session. Mark them `op=rebase` and treat them as metadata.
5. **Inherited `GIT_DIR` / `GIT_INDEX_FILE` in hook children.** A flusher that inherits them and runs `git -C otherRepo` reads the wrong repo. Scrub `GIT_*` from the environment.
6. **Test scripts that run git in the wrong directory.** A test whose `cd` fails will happily run `git checkout -b` or `git add` in whatever repo encloses the current directory (it happened while researching this slice). Use `git -C <abs path>`, `set -e`, `GIT_CEILING_DIRECTORIES`, and an isolated `GIT_CONFIG_GLOBAL` in every test.
7. **Remote MCP with OAuth.** Protected-resource metadata, CIMD (DCR is now deprecated), `iss` validation, audience-bound tokens. That is weeks of auth work for a feature stdio already covers. Defer it until claude.ai or mobile access is actually wanted.
8. **Chasing MCP spec churn.** 2026-07-28 removed the handshake and sessions, and the SDK split into v1 and v2. Pin `@modelcontextprotocol/server` v2 and keep tool handlers as thin wrappers over `ApiClient`, so the next spec change is a one-file fix.
9. **Plain stdout or exit 2 from `UserPromptSubmit`.** Plain stdout pollutes Claude's context on every prompt (tokens, and a prompt-injection surface). Exit 2 blocks the user's prompt. Print only JSON and always exit 0.
10. **Slow hooks.** The `UserPromptSubmit` default timeout is 30 s, so a hanging API call delays the user's prompt for half a minute. Self-impose 1.5 s. Async hooks have *no* enforced timeout, so set your own deadline or leak processes.
11. **Over-notifying.** A `systemMessage` on every prompt teaches the user to ignore it. Send one only when a session is *created* or a conflict appears.
12. **A webview task tree in VS Code.** Weeks of UI for something QuickPick plus separators already does. Same for a full `AuthenticationProvider`.
13. **WakaTime envy.** Tracking files, languages, and line counts is privacy-heavy, not needed for "last seen" (D-009), and invites dashboards nobody asked for.
14. **`engines.vscode` vs `@types/vscode` mismatch.** Building against 1.140 typings makes the `.vsix` refuse to install on Code OSS 1.138.
15. **Native modules in the `.vsix`.** keytar, or the keyring addon, means per-platform builds and Electron ABI issues. Use `SecretStorage` in the extension, and the keyring only in the CLI.
16. **No keyring daemon on bare window managers.** A Hyprland setup without gnome-keyring makes VS Code fall back to weaker storage and makes the CLI keyring throw. Atif has gnome-keyring running, but the file fallback (0600) and `planner doctor` exist for everyone else.
17. **Credentials in remote URLs.** `https://user:ghp_…@github.com/...` must be stripped before hashing *and* before it ever reaches the spool.
18. **PATH in GUI contexts.** Claude Code started from a launcher, or VS Code's git, may not see `~/.local/bin` or nvm's node. Bake absolute paths into the shims, and have `doctor` check what Claude Code sees.
19. **Publishing too early.** Marketplace needs an Azure DevOps PAT and a publisher. Open VSX needs an Eclipse account, the Publisher Agreement, and namespace claims. Sideload until the extension is boringly stable.

---

## 7. Edge cases and tests

The harness uses vitest with real `git` in temp dirs (isolated `GIT_CONFIG_GLOBAL`, `GIT_CEILING_DIRECTORIES`, `git -C`), a fake API on `node:http` that records requests and can return 500/401/429, and an injectable clock.

| # | Input | Expected |
|---|---|---|
| 1 | Commit in a linked repo, API up | Shim returns in < 50 ms. One file in `new/`. After flush, one `commit` event with key `commit:<rk>:<sha>`, file deleted. |
| 2 | Flusher killed after the API returned 200 but before the file was deleted; rerun | Second send gets `duplicate`, file deleted, server count unchanged. |
| 3 | API unreachable, 3 commits | All 3 commits complete normally. 3 files spooled. `backoff.json` set. When the API returns, the next commit's flusher sends all 3, oldest first, in one batch. |
| 4 | `git rebase main` replaying 3 commits | 3 commit events with `op=rebase`, plus one `rewrite` with 3 pairs. Server: old commits superseded, session totals unchanged. |
| 5 | `git commit --amend` 2 h after the original | New commit event (`authoredAt` old, `committedAt` now) plus `rewrite amend` pair within 3 s. Server counts activity at `committedAt`. The new SHA inherits the task link. |
| 6 | 200-commit rebase | At most 2 flusher processes ever alive. ≤ 3 HTTP requests (batches of 100 plus the rewrite). |
| 7 | Branch `feat/t42-recurrence`, message trailer `Planner-Task: t57` | Linked to t57, `mapping_note = trailer_overrode_branch`. |
| 8 | Branch `fix/404-page` | No branch match. Falls through to session or unsorted. |
| 9 | Branch `t42` where t42 belongs to another project | Ignored. Falls through. |
| 10 | Detached HEAD commit, not rebasing | `branch: null`. Mapping goes through steps 3–6. |
| 11 | Remote `https://atif:ghp_abc@GitHub.com/Atif/Tasks.git` | `remote = "github.com/atif/tasks"`. The string `ghp_` appears in no spool file and no request body. |
| 12 | `.planner` names `prj_X` that the user can't access (fork) | `link.error = foreign_project`, cached 24 h. Event sent with `repoKey` only and lands in the inbox. VS Code shows "Link folder". |
| 13 | `.planner` with a TOML syntax error on line 3 | Commit succeeds. Event has `malformed_dotfile`. `planner doctor` prints "line 3: …". |
| 14 | Monorepo commit touching 3 files under `apps/web`, 1 under `packages/core` | Project = the `apps/web` entry. |
| 15 | `git -c core.hooksPath=/dev/null commit` | The config hook still fires (verified), so this is documented. `PLANNER_DISABLE=1 git commit` spools nothing. |
| 16 | Repo with `hook.planner.enabled=false` | No spool file. |
| 17 | Husky repo with its own `post-commit` | Both run, planner first (verified). Husky's hook output is unchanged. |
| 18 | Repo outside `track.include`, not linked | The shim spools a stub. The flusher deletes it without sending. Zero requests. |
| 19 | Token revoked | 401, `needs-login` marker written, spool kept. `planner status` says "run planner login". VS Code shows "Sign in". |
| 20 | Client clock 2 days ahead | Server computes skew = `receivedAt − sentAt` and shifts the batch's times. Nothing lands in the future. |
| 21 | Repo deleted before flush | Minimal event sent (sha, branch, times). No crash, no `bad/` file. |
| 22 | VS Code: background `git pull` rewrites an open file while the window is unfocused | No mark, no heartbeat. |
| 23 | VS Code: 30 s of typing, then 20 min idle | Exactly one heartbeat. The server session ends at `windowEnd` once 15 min have passed. |
| 24 | VS Code: two windows on the same project, only one focused | Heartbeats only from the focused one. |
| 25 | VS Code: `Command`-kind selection changes (go-to-definition from a script) | Not counted. |
| 26 | Claude: first prompt in a linked repo, nothing running | One `ensure` call. `systemMessage` "Planner: started a session…". Exit 0. |
| 27 | Claude: second prompt 30 s later | No ensure. Heartbeat throttled (no request). No output. |
| 28 | Claude: API takes 10 s | Hook returns by ~1.6 s, exit 0, ensure spooled, one offline note. The prompt is not delayed further. |
| 29 | Claude: VS Code session already running on the same project | `created: false`. No message. |
| 30 | Claude: session for another project is running | Conflict message. No switch. |
| 31 | Claude in `~` (unlinked) | No request, no output. |
| 32 | Claude: single quick question, then exit | Inferred session < 5 min with one signal is hidden (junk filter) unless confirmed. |
| 33 | Malformed hook stdin | No output, exit 0. |
| 34 | MCP `breakdown_dump_item` with 0 or 25 subtasks | Schema validation error (SDK validates before the handler runs). |
| 35 | MCP call without a token | `isError: true`, text "Not signed in: run `planner login`". |
| 36 | `git worktree add ../wt`, commit there | Same `repoKey` as the main worktree. Rebase detection uses the worktree's git dir. |
| 37 | Commit inside a submodule | Its own `repoKey`. Unmatched unless linked. |
| 38 | 1 week offline with VS Code open | Spool bounded at 10k files / 20 MB, oldest heartbeats dropped first. All commits kept. |
| 39 | Path with spaces or Unicode (`~/Projects/कार्य app`) | Spooled and resolved correctly. `toplevel=` is read to end of file. |

---

## 8. Challenges to locked decisions

**D-006 ordering rationale (a challenge to the reasoning, with a proposed amendment, not a rejection).** D-006 orders git hook → VS Code → Claude Code because "Claude Code setup is heavier." That is true for an MCP server with OAuth, but no longer true for the *automatic* part once the CLI exists. The Claude Code hooks are about 2 days: a plugin manifest, five hook entries, and one `cc hook` subcommand reusing the spool and API code built for git. The VS Code extension is 2–3 weeks: auth UI, status bar, picker, activity tracker, packaging. Atif uses Claude Code daily, so the auto-start-on-first-prompt behaviour is the fastest path to fixing "commits mark the end of work" (risk §5) for real.

**Proposal:** git hook → **Claude Code hooks** → VS Code extension → Claude Code MCP → browser extension. The planned behaviours stay exactly as written in D-006. The build plan in §5.13 follows the locked order until Atif decides.

---

## 9. Open decisions for Atif

1. **Commit message privacy default.** (a) full subject, (b) subject only, body never, (c) hash only. **Default: (b).** It is your server, and the subject is what makes a session's commit list readable.
2. **Which repos are tracked at all.** (a) only linked repos, (b) linked plus `track.include` globs, (c) everything. **Default: (b) with `~/programming/**`.** The inbox makes unlinked repos useful, and the globs keep AUR clones and dotfiles out.
3. **`.planner` committed by default?** (a) committed, (b) local-only by default. **Default: (a) for your repos, with `--local` for others'.**
4. **Task ref in branch names.** (a) `t42` token anywhere (`feat/t42-topic`), (b) trailing number `feat/topic-42`, (c) none, trailers only. **Default: (a).** It fits your `<type>/<topic>` convention and avoids false positives like `fix/404`.
5. **Trailer key.** (a) `Planner-Task:`, (b) `Task:`, (c) `Refs:`. **Default: (a).** Unambiguous, and won't clash with other tools.
6. **Gap thresholds.** Accept 15 / 20 / 60 min and a 30-min learned allowance, or change them? **Default: accept, revisit after 2 weeks of dogfooding.**
7. **Does Claude's autonomous run time count?** (a) all of it, (b) only up to 20 min after the last *user* prompt, (c) prompts only. **Default: (a) with the 20-min gap.** You are supervising, and evening review can trim it.
8. **Minimum inferred session length.** (a) 0, (b) 5 min, (c) 10 min. **Default: (b).**
9. **CLI distribution.** (a) `npm i -g`, (b) single binary (`bun build --compile`), (c) AUR package. **Default: (a) now, (c) later as a portfolio touch.**
10. **VS Code publishing.** (a) sideload only, (b) Open VSX, (c) both stores. **Default: (a) until 2 weeks of stable use, then (c).**
11. **Claude notifications.** (a) `systemMessage` only, (b) plus a desktop notification via OSC 777, (c) off. **Default: (a).** Make (b) an option because Hyprland plus a terminal that supports OSC 777 makes it nice.
12. **Amend D-006's order** (§8)? (a) keep, (b) Claude hooks before VS Code. **Default: (b).**

---

## 10. Proposed JOURNEY.md entries

### D-0XX · Integrations share one client core and a `planner` CLI, no daemon (2026-10-05)
- **Decision:** All local integrations use one TypeScript `planner-core` (config, link resolution, spool, flush, API, tokens). One `planner` CLI acts as git flusher, Claude Code hook handler, and stdio MCP server. The VS Code extension bundles the core. All clients write to one on-disk spool, and every event has an idempotency key.
- **Why:** The hard parts (offline retry, crash safety, privacy filtering, rewrite handling) are needed by every client and are miserable in shell. One tested implementation beats three drifting ones.
- **Alternatives:** per-tool thin clients (rejected: logic duplicated in sh and TS), local daemon (rejected: lifecycle cost and data loss when it's down), GitHub webhooks only (rejected: sees pushes, not work; kept as a possible backfill).

### D-0XX · Git hook is a config-based global hook (Git ≥ 2.54) writing to a spool (2026-10-05)
- **Decision:** Install `hook.planner` (post-commit) and `hook.planner-rewrite` (post-rewrite) in `~/.gitconfig`. The hook is a tiny `sh` shim that writes one file and spawns at most one detached flusher. Never set a global `core.hooksPath`. Per-repo opt-out is `hook.planner.enabled=false`. Older Git gets a per-repo chaining shim.
- **Why:** Config hooks coexist with husky, lefthook, and pre-commit (verified on 2.55.0). A commit never waits on the network, and rebase floods cost one process.
- **Consequences:** `git -c core.hooksPath=/dev/null` does not disable the planner hook, so `PLANNER_DISABLE=1` exists for that.

### D-0XX · Commit → task precedence (2026-10-05)
- **Decision:** `Planner-Task:` trailer → `t<number>` token in the branch → running session's task in the same project → `.planner` `default_task` → project "unsorted" → unmatched-commits inbox. Linking a repo from the inbox claims its past commits. Name matching only suggests.
- **Why:** Explicit beats inferred, and nothing is silently mislinked. The inbox makes "forgot to link" recoverable.
- **Alternatives:** active task only (wrong after context switches), branch only (no per-commit override).

### D-0XX · `.planner` link file: TOML, opaque project id, committed (2026-10-05)
- **Decision:** `.planner` at the repo root holds `version`, `project = "prj_…"`, an optional `name`, `server`, `default_task`, and `[[path]]` prefixes for monorepos. Personal links live in `~/.config/planner/links.toml` and override the file. A foreign id (fork) degrades to unlinked.
- **Why:** An id survives renames, contains no secrets, and travels with clones. A local override covers repos you don't own and non-git folders.
- **Consequences:** Closes the §5 risk "matching a folder to a project by name is fragile".

### D-0XX · Per-source gap thresholds, inferred sessions, learned commit allowance (2026-10-05)
- **Decision:** Server-side defaults per user: VS Code 15 min, Claude Code 20 min, commit-to-commit 60 min. A commit-only session is back-dated by a learned allowance (median of observed first-commit delays, default 30, clamped 10–90 min), never past earlier activity, and marked inferred. Inferred sessions under 5 min with one signal are hidden. Rebased and cherry-picked commits are metadata, not activity.
- **Why:** Answers §7's gap question with numbers that can be tuned without client releases. Addresses "commits mark the end of work" with data the app already has.

### D-0XX · Claude Code integration is a plugin: hooks for tracking, local stdio MCP for requests (2026-10-05)
- **Decision:** `UserPromptSubmit` ensures a session on the first prompt in a linked folder and notifies via `systemMessage` only on creation or conflict. `PostToolBatch` and `Stop` send async throttled heartbeats. `SessionStart` injects a short context line. A stdio MCP server exposes 10 tools, including `next_task`, `log_note`, `capture`, and `breakdown_dump_item`. Remote MCP is deferred.
- **Why:** Hooks are reliable for automatic behaviour; MCP is right for conversational actions. Dump breakdown uses the user's own Claude, so it costs us nothing (fits D-002).

### D-0XX · One token per client per device (2026-10-05)
- **Decision:** CLI, VS Code, and Claude Code each get their own scoped PAT ("VS Code on rury"), obtained via device-code login or a Settings preset. Storage: OS keyring for the CLI, `SecretStorage` for VS Code, plugin `userConfig` (sensitive) for Claude Code.
- **Why:** Least privilege, per-client revocation, `lastUsedAt` per client is useful for debugging, and no native modules are needed inside the VS Code extension.
