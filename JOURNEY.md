# Planner App — Build Journey

> Working name: TBD
> Started: 2026-10-05
> Purpose of this file: a running log of every decision, debate, problem, mistake and fix, so the full story is available later (and for interviews).

---

## 1. Vision

A calendar + tasks hybrid for students and builders. Your fixed week (classes, runs, writing days) is always visible. Tasks and projects sit right beside it, and you can drag them onto free time. Built for one use case, opinionated, not a blank canvas.

**Origin:** I needed this myself. Existing apps were either paid, bloated, or too thin.

## 2. Core surface (three sections, no more)

| Section | What it holds |
|---|---|
| **Calendar** | Recurring blocks (daily / weekly / custom). Blocks can be cancelled (greyed + diagonal stripes, not deleted). Drag tasks in to plan time. |
| **Tasks** | Misc todo list + Projects (each with nested tasks). Timer and sessions per task; optional notes / commit refs per session. |
| **Thought dump** | Fast capture (typed or voice) of ideas that need more thinking before they become tasks. General or per project. |

**Long term:** a shared user space across tools on `*.ahmedatif.in`.

---

## 3. Decisions log

Format: what was decided → why → alternatives considered.

### D-001 · Keep the three-section scope (2026-10-05)
- **Decision:** Calendar, Tasks/Projects, Thought dump form the core. All features must serve "organize my day."
- **Why:** Feature *count* matters less than *cohesion*. Notion is a general note tool you have to configure. This app is opinionated for one flow.
- **Pushback received:** risk of rebuilding Notion.
- **Resolution:** The core is coherent. The real scope risk is the *integrations* (MCP, VS Code, browser extension, ecosystem). Those stay later-phase.

### D-002 · No ChatGPT-plan integration (2026-10-05)
- **Decision:** Don't depend on users' ChatGPT plans.
- **Why:** That route needs Plus/Pro, so it doesn't work for free users.
- **Consequence:** Scheduling logic leans algorithmic. LLM use becomes optional and goes behind a provider interface.

### D-003 · No Google Calendar sync for v1 (2026-10-05)
- **Decision:** Skip two-way sync.
- **Why:** Not used by the target user (me). The KIIT uni calendar lives on the college portal.
- **Maybe later:** a cheap one-way ICS export, and a holiday import that bulk-cancels classes.

### D-004 · Recurring groups / "schedules" (2026-10-05)
- **Decision:** Recurring items belong to named groups (e.g. "Classes", "Writing").
- **Group properties:** colour, active date range, attendance on/off.
- **Semester change:** archive the old group, add the new one, and the app shows conflicts with other groups.
- **Why:** Semester changes become a one-step swap. History and attendance survive because groups are archived, not deleted.

### D-005 · Attendance: default = attended (2026-10-05)
- **Decision:** Only deviations get marked. The cancel action asks once: "Prof cancelled" or "I skipped."
- **Why:** Marking every class as attended would be a chore. You were already tapping cancel for the visual, so the split costs zero extra taps.
- **Scope:** Only for groups that have attendance turned on.
- **Known gap:** an unmarked skip counts as attended. See D-010.

### D-006 · Integrations are add-ons, built in order (2026-10-05)
- **Decision:** Core first. Then the **git post-commit hook**, then the **VS Code extension**, then **Claude Code hooks/plugin**. Browser extension last.
- **Why:** The git hook is tool-agnostic, tiny, and solves the "forgot to start the timer" problem early. Claude Code setup is heavier.
- **Planned Claude Code behaviour:** the first prompt in a project folder auto-starts a session (if none is running) and notifies the user.
- **Planned VS Code behaviour:** a Start button; auto-match the project from the working directory; pick the task from the project's task tree.

### D-007 · PWA first, native later (2026-10-05)
- **Decision:** Ship a PWA. Move to a native app gradually, mainly for widgets.
- **Why:** App store costs; the PWA works for everyone in the meantime. The backend is API-first, so a native app is just another client.

### D-008 · Uni calendar import via an LLM prompt (2026-10-05)
- **Decision:** Define a custom import format. Give users a ready-made prompt that converts their uni calendar into that format with any LLM; they paste the result back in.
- **Why:** Zero LLM cost on our side, and it works for any university.
- **Guardrail:** validate the data and show a preview before applying, since LLMs can get dates wrong.

### D-009 · Heartbeats: batch and treat as "last seen," don't store each ping (2026-10-05)
- **Decision:** Clients batch activity and send roughly every 2 minutes, only while active. The server updates a session's `last_seen` instead of storing every ping. A gap longer than the threshold closes the session (computed lazily).
- **Why:** The worry was load at scale. Latency tolerance here is minutes, unlike Ruyah's real-time sync, so batching is fine. Rough math: 10k people actively coding, one request per 2 min each ≈ 83 req/s, which one server handles easily.

### D-010 · Attendance: confirm in the evening shutdown (2026-10-05)
- **Problem:** with default-attended, a skip that's never marked inflates attendance.
- **Decision:** The evening shutdown shows today's classes pre-ticked as "went"; one tap flips one to "skipped." Classes not yet reviewed count as *unconfirmed*, and attendance shows as a range until they're confirmed.

---

## 4. Debates & pushback (how I handled feedback)

| # | Concern raised | My response | Outcome |
|---|---|---|---|
| 2 | Too many features → becomes Notion | Three sections, one goal; Notion is general-purpose and setup-heavy | Core kept; integrations deferred (D-001) |
| 4 | Logging friction kills apps | Dump has no dailies; voice capture; AI/manual breakdown later | Agreed for dump; friction still matters for **timers**, so automate those (commit/heartbeat idea) |
| 5 | Thought dump → graveyard | Dump is meant for later breakdown, by design | Accepted; add gentle aging signal, not a forced ritual |
| Attendance | Marking skipped = chore | Valid | Default-attended model (D-005) |

---

## 5. Risks & open problems

| Risk | Status | Mitigation |
|---|---|---|
| Recurrence edge cases (one-off cancel/move, "this and following", semester end, DST) | **Open** | Deep dive during backend design |
| Timer friction | Partly addressed | Server-owned timer; auto sessions from commits/editor |
| Commits mark the *end* of work, not the start | Partly addressed | Start signals from the VS Code Start button and Claude Code's first prompt (D-006) |
| Heartbeat load at scale | Addressed | Batching + `last_seen` updates (D-009) |
| Unmarked skips inflate attendance | Addressed | Evening confirm + "unconfirmed" range (D-010) |
| Matching a folder to a project by name is fragile (renames, duplicate names) | **Open** | Proposed: a small `.planner` link file in the repo root, with name matching only as a fallback |
| No free LLM via ChatGPT | Addressed | Algorithmic-first; provider interface; free-tier / BYO-key options |
| Mobile capture speed (widgets, share sheet are native-only) | **Open** | PWA first; native wrapper later if needed |
| Timetable formats vary wildly | Parked | Support KIIT format first if built |

---

## 6. Feature backlog

| Feature | Status | Notes |
|---|---|---|
| Recurring blocks + cancel state | ✅ Core | |
| Recurring groups (swappable per semester, conflict view) | ✅ Core | D-004 |
| Tasks + projects (nested) + drag to calendar | ✅ Core | Task / Block / Session separation |
| Timer + sessions, notes, commit refs | ✅ Core | |
| Thought dump (text + voice) | ✅ Core | |
| "You just got time back" suggestions | ✅ Accepted | Pure algorithm, fit tasks into gaps |
| Estimation multiplier | ✅ Accepted | Algorithm-heavy, per category |
| Natural-language quick add | ✅ Accepted | Rule parser first |
| Evening shutdown reminder | ✅ Accepted | Needs push notifications |
| Attendance tracking | ✅ Accepted | Default-attended (D-005) |
| Auto-attach commits / auto sessions | ✅ Accepted ("gold") | git hook → VS Code ext → MCP / Claude Code hook |
| Screenshot timetable import | 🅿️ Parked | Formats vary; KIIT-only first |
| Browser extension | 🔭 Far future | |
| Shared `*.ahmedatif.in` identity | 🔭 Far future | |
| AI breakdown of dump items | 🔭 Optional | Behind provider interface |

---

## 7. Open questions

- PWA vs native app on a shared backend? (Leaning: PWA first, API-first backend.)
- Which free/cheap LLM path, if any? (Free-tier APIs, BYO key, on-device.)
- Session gap threshold for commit-based sessions?
- How are commits mapped to tasks? (Branch name, commit trailer, or the active task.)
- App name.

---

## 8. Roadmap (draft)

1. **v0** — Recurring calendar, groups, cancel/skip. Dogfood for 2 weeks.
2. **v1** — Tasks/projects, drag → block, timer/sessions, thought dump.
3. **v2** — Attendance, quick add, "time back", estimation multiplier, shutdown reminder.
4. **v3** — git hook auto sessions → VS Code extension → MCP / Claude Code integration.
5. **Later** — Timetable import, browser extension, shared identity.

---

## 9. Session log

### 2026-10-05 · Session 1 — Idea critique
- Shared the full idea; received critique (8 cracks), innovation ideas, and a first HLD/LLD pass.
- Pushed back on scope (#2) and the graveyard concern (#5); reached resolutions (see §4).
- Learned ChatGPT-plan access is Plus/Pro only → pivoted to algorithmic-first (D-002).
- New idea of my own: **recurring groups** swappable per semester with conflict detection (D-004).
- Fixed attendance friction with the default-attended model (D-005).
- Proposed automated work sessions from commits (heartbeat + gap timeout).
- **Next:** backend design, with the recurrence engine deep dive first.

### 2026-10-05 · Session 2 — Follow-ups
- Locked the integration order: git hook → VS Code → Claude Code (D-006).
- Worried heartbeats wouldn't scale with many users. Worked through the math; batching + `last_seen` makes it cheap (D-009). Learned the key difference from Ruyah: this needs minutes of latency tolerance, not milliseconds.
- Designed how Claude Code and VS Code start sessions automatically (D-006).
- Uni calendar import via a user-run LLM prompt + custom format (D-008).
- PWA first, native app later for widgets (D-007).
- Found a hole in the attendance design (unmarked skips) and fixed it (D-010).
- Realised the estimation multiplier update is like a learning-rate step on the error, the same idea as training a model.
