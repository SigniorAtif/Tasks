# Course map: web dev course → this project

How each phase of the Udemy course maps to the planner app, and what the course doesn't cover that we'll fill in here.

## Phase by phase

| Phase | Topics | Used in this project? |
|---|---|---|
| 0 Intro | Careers, freelancing | No |
| 1 Foundations | HTML, CSS, Tailwind, JavaScript | **Essential.** JavaScript especially: everything we write is JS with types on top. |
| 2 Backend | Node, Express | **Yes.** Hono is the same idea as Express: routes, handlers, middleware. Learn Express; the switch to Hono is small. See [[How a request travels]]. |
| | Mongoose (MongoDB) | Lightly. We use Postgres. It's still useful to know what a document database is, to understand why we didn't pick one. |
| | Prisma, **Drizzle**, **PostgreSQL**, NeonDB | **Yes, directly.** Drizzle is our ORM and Postgres is our database. Neon was considered and rejected (`docs/brainstorm/04` §4.6), because our Postgres runs on the VPS. |
| | Build your own auth | **Yes, very relevant.** We use Better Auth for browser login, but write our own tokens. Understanding hand-made auth first makes both clear. |
| | APIs | **Yes.** |
| | VPS deployment | **Yes.** Our hosting is one VPS. |
| 3 React | React, API handling | **Essential.** The app is React. |
| | Redux Toolkit, Zustand | Partly. Server data lives in TanStack Query, not Redux. Zustand may hold small UI-only state. |
| 4 Full-stack + AI | Projects | Useful practice. |
| | TensorFlow.js, LangChain | No, not for this app. LLMs stay off by default (`docs/brainstorm/10-scheduling-algorithms`). |

## Gaps: not in the course, needed here

These get concept notes in this vault when they first appear in code:

- **TypeScript.** The whole project is TypeScript and the course outline doesn't list it. It's the most important gap. A short TS primer after Phase 1 is enough to start: that primer is [[TypeScript essentials]] (written 2026-10-14), which teaches the TypeScript our code uses with lines from our code.
- **Testing** (Vitest, property tests). Every feature ships with tests; reading them is the fastest way to learn what the code is supposed to do.
- **SQL beyond the ORM.** Joins, indexes, constraints and transactions. ORMs hide these, and interviews ask about them.
- **Time and time zones** (Temporal API). The calendar depends on this.
- **Docker / Compose.** How our VPS runs things. The deployment phase may touch it.

## Suggested pace

You don't need to finish the whole course before studying this code. The first module (the recurrence engine) needs only **Phase 1 JavaScript plus a TypeScript primer** ([[TypeScript essentials]]) to read. Phase 2 lines up with the API work, and Phase 3 with the frontend work.
