# Environment variables and config

> **Builds on:** nothing. A starting point.

An **environment variable** is a named text value the operating system hands to a program when it starts: `PORT=3000`, `DATABASE_URL=postgres://…`. The program reads it (in Node, `process.env.PORT`) instead of having the value written into its code.

## Why not just write the values in the code?

Because the same code runs in different places with different settings:

| Setting | Your laptop | The VPS |
|---|---|---|
| `DATABASE_URL` | `postgres://tasks:tasks@localhost:5432/tasks` | the production database, real password |
| `BETTER_AUTH_URL` | `http://localhost:5173` | `https://tasks.ahmedatif.in` |
| `BETTER_AUTH_SECRET` | a public dev value | 32 random characters nobody has seen |

And the repo is public. A secret written in code is a secret published on GitHub. Environment variables keep secrets out of git: the real ones live only on the server.

## Where they come from here

- **`.env`** at the repo root: a text file of `NAME=value` lines, git-ignored. The scripts load it with `node --env-file-if-exists=../../.env`. `.env.example` (committed) lists every variable with a comment and is the file to copy.
- **The shell:** `PORT=4000 pnpm --filter @tasks/api start`.
- **Docker:** the image sets `NODE_ENV=production`, `HOST=0.0.0.0`, `STATIC_DIR`, `GIT_SHA`; the server's compose file passes the secrets.

## Check once, at start-up

`apps/api/src/env.ts` reads **every** variable once, when the server starts, checks it with a zod schema, and hands the rest of the code a typed `Env` object. Nothing else reads `process.env`.

Compare two ways to find a typo in `DATABSE_URL`:
- **Read where needed:** the server starts happily, and the first request that touches the database crashes, maybe at 2 a.m., maybe only on the VPS.
- **Check at start-up:** the server refuses to start and prints `DATABASE_URL: is required in production`. The deploy fails loudly; the old version keeps running.

That second style is called **failing fast**. In our app it's the last step of reading the environment:

*From `apps/api/src/env.ts`:*
```ts
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = parseEnv(source);
  if (!result.ok) {
    console.error(
      `The API can't start: some environment variables are wrong (see .env.example).\n${result.problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
  return result.env;
}
```

What to notice:
- `process.exit(1)` stops the program on the spot; exit code 1 means "failed", which is what makes a deploy or `docker compose` notice.
- It prints *every* problem, one per line (`.map(...)` turns each into `  - DATABASE_URL: is required in production`), so you fix them all in one go instead of one per restart.
- `source = process.env` is a default value: `main.ts` calls `loadEnv()` with nothing, and this is the one place in the server's code (test helpers aside) that touches `process.env`.

Rules in our schema:
- An empty value (`PORT=`) counts as unset.
- Development and test fill safe defaults, so a fresh clone runs without a `.env`.
- Production has **no** defaults for the database URL, the origin, the secret, the Google client and the allowlist, and refuses the public development secret.
- Error messages name the variable and the rule, **never the value**: the value might be a secret, and these messages end up in logs.

The production rule and the development defaults, side by side:

*From `apps/api/src/env.ts` (shortened):*
```ts
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const name of REQUIRED_IN_PRODUCTION) {
        if (env[name] === undefined) {
          ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
        }
      }
      // … the check that refuses the public development secret
    }
    // …
  })
  .transform((env) => ({
    ...env,
    // In production these are present (checked above); elsewhere, fill the dev defaults.
    DATABASE_URL: env.DATABASE_URL ?? DEV_DEFAULTS.DATABASE_URL,
    // …
```

What to notice:
- `superRefine` is zod's place for rules that look at several variables at once (here: "if `NODE_ENV` is production, then these six must exist"). `ctx.addIssue` records a problem and carries on, so one start-up reports every mistake.
- A problem is just `path: [name]` plus a `message`: the variable's name and the rule. The value never goes in.
- `??` fills a development default only when the value is missing. In production the check above has already made sure nothing is missing, so no default can sneak in there.

## `NODE_ENV`

A convention across the Node world: `development`, `test` or `production`. Libraries read it too (Better Auth turns its origin check off when it says `test`; we turn it back on explicitly, so tests check what production does).

## Check yourself
- You set `GOOGLE_CLIENT_ID` in `.env` but forget `GOOGLE_CLIENT_SECRET`. What happens when you run `pnpm dev`, and why is that better than starting without Google?
- Why does `parseEnv` take the variables as an argument instead of reading `process.env` itself? (Look at `env.test.ts`.)
- A teammate pastes the production `.env` into a GitHub issue to ask for help. Which lines must be rotated (replaced with new values), and which are harmless?
