# Reading order

The guide: what to read, in which order. Each note's first line says what it needs before it, so this page only gives the order. Back to [[00 Start here]] · Terms: [[Glossary]]

## Path 1: v0.0, the walking skeleton (API, database, sign-in, PWA, deploy)

**New to TypeScript?** Every code sample in the vault is TypeScript, and your course teaches JavaScript. Read [[TypeScript essentials]] first (about 30 minutes). It uses real lines from our code.

Top-down: our app first, foundations as you meet them.

1. [[v0.0 in plain words]]: the whole milestone, without jargon.
2. [[v0.0 contracts]] (a decision): the names and shapes every part agreed on before it was built.
3. [[One request, line by line]]: one real request through every file, phone → database → phone. After this, everything else has a place to hang on.
4. [[API server]]: the server's files, the middleware stack, start-up and shutdown.
5. [[Database and migrations]]: the tables, and how they're created and changed.
6. [[Auth]]: Google sign-in step by step, the allowlist, the session cookie.
7. [[Web app]]: the PWA's screens, data fetching, offline, installing.
8. [[Deploy and CI]]: the image, the server stack, CI on every PR, deploying on merge, rollback.
9. [[Local workflow]]: how to work day to day, and check a change before pushing. Keep it open while you work.

The "why" behind this path: [[API stack choices]] · [[Web stack choices]] · [[Deploy choices]].

## Path 2: v0.1, the recurrence engine (monorepo, shared types, calendar maths)

1. [[v0.1 in plain words]]
2. [[Repo root and tooling]]: what every file at the top of the repo does.
3. [[Core types]]: the shared dictionary of names.
4. [[Recurrence engine]]: how rules, overrides and holidays become the occurrences on your calendar.

The "why": [[First-commit decisions]] · [[Tooling choices]] · [[Recurrence engine choices]] · [[Why no Next.js]].

## Path 3: v0.2, the readable calendar (your timetable, row-level security, the grid, offline)

The server and the database first, then the screens, like path 1.

1. [[v0.2 in plain words]]: the whole milestone without jargon, including what was checked against your real timetable.
2. [[v0.2 contracts]] (a decision): the shapes, rules, tables and the row-level security migration everyone built against.
3. [[Calendar API]]: the routes, one calendar request traced from the cookie to the engine to JSON, and the status codes.
   Then [[One write, line by line]]: saving a class, traced through every file from the tap on Save to the database and back to the calendar. If you read one note on how the frontend and the backend work together, make it this one.
4. [[Row-level security in our database]]: how every one of those queries is limited to you, and what the cross-user tests prove.
5. [[Timetable files and seeding]]: the timetable file format, and how your real timetable reaches only your laptop's database.
6. [[Calendar grid]]: how an occurrence becomes a block on the screen.
7. [[Offline reads]]: opening the app with no signal.
8. [[Series form]]: adding, changing and deleting a class.

The "why" behind this path: [[Calendar API choices]] · [[Calendar grid choices]] · [[Offline and form choices]].

## Path 4: v0.3, cancelling and groups (being built)

1. [[Cancel and group choices]] (a decision): what was settled before any code, with the examples that settled it. The app notes follow as the milestone is built.
2. Groups lost their first day (ticket #7). No new note: the change runs through existing ones. Read [[Recurrence engine]] (clipping, and extras after a group's last day), then [[Database and migrations]] (migration `0003`: a rename drizzle-kit has to ask about, and the expand-only rule it breaks once), then [[Series form]] (the first day suggested from the group).
3. Cancelling one class (ticket #8): [[Upserts and row locks]] and [[Dialogs and toasts]] first, then [[Cancelling one occurrence]]: the sheet, the `PATCH`, the row that's deleted when it says nothing, and Undo.
4. Cancels that work offline (ticket #9): [[Mutations and offline queues]] and [[Web Locks and BroadcastChannel]] first, then [[Offline cancels]]: the queue, the clock mark, the saved copy, the startup order, signing out, and one tab at a time. The "why": [[Offline cancel choices]].
5. The end-to-end test (ticket #10): [[End-to-end tests and Playwright]] first, then [[End-to-end test]]: the server it starts, the empty database, signing in without Google, the steps, the fresh browser, and the bug it found in the saved copy (the fix is in [[Offline reads]]). The "why": [[End-to-end test choices]].
6. The Groups screen (ticket #11): [[Time zones and daylight saving]] first if it's been a while, then [[The user's day]] (when "today" starts, and when a group counts as ended), [[Shared form pieces]] (what the series form gave up so a second form could use it), and [[Groups screen]] (the list, the natural sort, the form). The "why": [[Groups screen choices]].

## Path 5: v0.3b, the swap, days off and changing a series (decided, built after v0.3)

1. [[Swap, days off and series choices]] (a decision): series in no group, one-offs, "Applies from", the semester swap, clashes, days off, moves, extras and notes. Read [[Cancel and group choices]] first; this one builds on it.

## Foundations, in order (bottom-up)

Subject by subject. Inside each subject, each note builds on the ones above it. Subjects 1–4 are what the backend needs; 5–8 can wait until you meet them.

1. **The web** (`foundations/web/`): [[HTTP basics]] → [[How a request travels]] → [[Origin]] → [[Cookies and sessions]] → [[Hashing and signing]] → [[OAuth sign-in]] → [[Reverse proxies and TLS]] → [[REST resources and CRUD]] → [[Idempotency and retries]]
2. **Server code** (`foundations/server/`): [[Environment variables and config]] → [[Middleware]] → [[Error responses]] → [[Validating input with schemas]] → [[Structured logging]]
3. **Databases** (`foundations/database/`): [[Postgres and SQL basics]] → [[Database migrations]] → [[Connection pools]] → [[Transactions]] → [[Upserts and row locks]] → [[Roles and privileges]] → [[Row-level security]]
4. **Shipping** (`foundations/shipping/`): [[Containers and images]] → [[Docker Compose]] → [[CI and CD]] → [[Secret scanning]]
5. **Browser apps** (`foundations/browser/`): [[Single-page apps and routing]] → [[Server state and caching]] → [[PWAs and service workers]] → [[Dev server proxy]] → [[IndexedDB and offline storage]] → [[Responsive layouts]] → [[CSS variables]] → [[Dialogs and toasts]] → [[Mutations and offline queues]] → [[Web Locks and BroadcastChannel]]
6. **Time** (`foundations/time/`): [[Dates, times and instants]] → [[Time zones and daylight saving]]
7. **Tooling and testing** (`foundations/tooling/`): [[TypeScript essentials]] → [[Monorepo and workspaces]] → [[TypeScript checking vs running]] → [[Testing pure code]] → [[Integration tests]] → [[End-to-end tests and Playwright]]
8. **Algorithms** (`foundations/algorithms/`): [[Interval partitioning]] (it uses the half-open ranges from [[Dates, times and instants]], so read that first)

## If you only have 20 minutes

[[v0.0 in plain words]], then [[One request, line by line]]. For the calendar: [[v0.2 in plain words]].

## Check yourself
- Without opening anything: which `app/` note would tell you what happens when a deploy fails? Which foundation note explains why the database's data survives that deploy?
