# Reading order

The guide: what to read, in which order. Each note's first line says what it needs before it, so this page only gives the order. Back to [[00 Start here]] · Terms: [[Glossary]]

## Path 1: v0.0, the walking skeleton (API, database, sign-in, PWA, deploy)

**New to TypeScript?** Every code sample in the vault is TypeScript, and your course teaches JavaScript. Read [[TypeScript essentials]] first (about 30 minutes); it uses real lines from our code.

Top-down: our app first, foundations as you meet them.

1. [[v0.0 in plain words]]: the whole milestone without jargon.
2. [[v0.0 contracts]] (a decision): the names and shapes every part agreed on before it was built.
3. [[One request, line by line]]: one real request through every file, phone → database → phone. After this, everything else has a place to hang on.
4. [[API server]]: the server's files, the middleware stack, start-up and shutdown.
5. [[Database and migrations]]: the tables, and how they're created and changed.
6. [[Auth]]: Google sign-in step by step, the allowlist, the session cookie.
7. [[Web app]]: the PWA: screens, data fetching, offline, installing.
8. [[Deploy and CI]]: the image, the server stack, CI on every PR, deploying on merge, rollback.
9. [[Local workflow]]: how to work day to day and check a change before pushing. Keep it open while working.

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
3. [[Calendar API]]: the routes, one calendar request traced from the cookie to the engine to JSON, the status codes.
   Then [[One write, line by line]]: saving a class traced through every file, from the tap on Save to the database and back to the calendar. The best single note for how the frontend and the backend work together.
4. [[Row-level security in our database]]: how every one of those queries is limited to you, and what the cross-user tests prove.
5. [[Timetable files and seeding]]: the timetable file format and how your real timetable reaches only your laptop's database.
6. [[Calendar grid]]: how an occurrence becomes a block on the screen.
7. [[Offline reads]]: opening the app with no signal.
8. [[Series form]]: adding, changing and deleting a class.

The "why" behind this path: [[Calendar API choices]] · [[Calendar grid choices]] · [[Offline and form choices]].

## Path 4: v0.3, cancelling and groups (being built)

1. [[Cancel and group choices]] (a decision): what was settled before any code, with the examples that settled it. The app notes follow as the milestone is built.

## Foundations, in order (bottom-up)

Subject by subject. Inside each subject, each note builds on the ones above it. Subjects 1–4 are what the backend needs; 5–8 can wait until you meet them.

1. **The web** (`foundations/web/`): [[HTTP basics]] → [[How a request travels]] → [[Origin]] → [[Cookies and sessions]] → [[Hashing and signing]] → [[OAuth sign-in]] → [[Reverse proxies and TLS]] → [[REST resources and CRUD]] → [[Idempotency and retries]]
2. **Server code** (`foundations/server/`): [[Environment variables and config]] → [[Middleware]] → [[Error responses]] → [[Validating input with schemas]] → [[Structured logging]]
3. **Databases** (`foundations/database/`): [[Postgres and SQL basics]] → [[Database migrations]] → [[Connection pools]] → [[Transactions]] → [[Roles and privileges]] → [[Row-level security]]
4. **Shipping** (`foundations/shipping/`): [[Containers and images]] → [[Docker Compose]] → [[CI and CD]] → [[Secret scanning]]
5. **Browser apps** (`foundations/browser/`): [[Single-page apps and routing]] → [[Server state and caching]] → [[PWAs and service workers]] → [[Dev server proxy]] → [[IndexedDB and offline storage]] → [[Responsive layouts]] → [[CSS variables]]
6. **Time** (`foundations/time/`): [[Dates, times and instants]] → [[Time zones and daylight saving]]
7. **Tooling and testing** (`foundations/tooling/`): [[TypeScript essentials]] → [[Monorepo and workspaces]] → [[TypeScript checking vs running]] → [[Testing pure code]] → [[Integration tests]]
8. **Algorithms** (`foundations/algorithms/`): [[Interval partitioning]] (it uses the half-open ranges from [[Dates, times and instants]]; read that first)

## If you only have 20 minutes

[[v0.0 in plain words]], then [[One request, line by line]]. For the calendar: [[v0.2 in plain words]].

## Check yourself
- Without opening anything: which `app/` note would tell you what happens when a deploy fails? Which foundation note explains why the database's data survives that deploy?
