# End-to-end test choices

The choices made while building ticket #10, the first end-to-end test. The plan was one line in **ADR v0.3** (`JOURNEY.md`): "One Playwright test joins (create, cancel with a reason, reload, the stripes stay)", and spec #6 added that it signs in through the dev-session helper, runs against the built app and the API with a real Postgres, and runs in CI. Everything below filled the gaps around that line. PR #20 lists them. How the code does it: [[End-to-end test]]. The ideas underneath: [[End-to-end tests and Playwright]].

## Its own package, with a script called `e2e`

The test lives in `e2e/`, a workspace package of its own, and its script is `e2e`, not `test`.

Why: `pnpm test` runs the `test` script of every package. Had this one been called `test`, every `pnpm test` would need a built app, a downloaded Chromium and a spare port, and would take three times as long. Kept apart, `pnpm test` stays what it was, and `pnpm e2e` is a separate, deliberate step. A package of its own also keeps Playwright out of the web app's dependencies, so the Docker image never sees it.

What lost:
- **Inside `apps/web`.** It works (the web app's Vitest only picks up `*.test.ts`, so it would leave a `*.spec.ts` alone), but the web app would carry a dependency its own build and tests never use, and the two kinds of test would share one `tsconfig` meant for browser code.
- **Loose files at the repo root.** `pnpm typecheck` runs in each package, not at the root, so root files would never be typechecked.

## The API serves the build, on its own port

The test runs against `apps/web/dist`, served by the API itself (`STATIC_DIR`) on port 3100.

Why: that's how production serves it, one server for both the page and `/api`, so the cookie, the origin checks and the service worker all behave as they do on the phone. Port 3100 keeps it clear of a dev server you may have running.

What lost:
- **`vite preview`, forwarding `/api` to the API.** It also serves the build, but adds a second server and a proxy that production doesn't have.
- **The dev server (`pnpm dev`).** It serves source files, not the build, and has no service worker, so the test would check something no phone ever runs.
- **Reusing a server that's already running.** Faster to start, but it may be running yesterday's code against yesterday's data. The run refuses an occupied port instead (`reuseExistingServer: false`).

## Its own database, emptied at every start; one worker; no retries

`tasks_e2e` is emptied before the API starts. Tests run one at a time, and a failed test isn't tried again.

Why: the test adds a class called Pottery. On a database that still held the last run's Pottery, today would have two blocks, and the test couldn't tell which one it cancelled. A retry has the same problem: the second try finds the first try's Pottery and fails for a reason that has nothing to do with the bug. And a test that's retried until it passes hides flakiness instead of reporting it.

What lost:
- **Unique names per run** ("Pottery 17"), with no wipe. The calendar would fill up with old classes run after run, and the one-day view would get crowded.
- **Retries in CI**, Playwright's usual advice. Worth it for a big suite on a slow network, not for one test that should never flake.

## Sign in with `dev:session`, not a fake Google

The test runs the API's own `dev:session` script and puts the cookie it prints into the browser.

Why: it's the helper the spec named, and it makes the same user and session rows a real sign-in makes, through Better Auth's own code. The Google flow is already covered, end to end, by the API's integration tests with a fake Google ([[Integration tests]]); repeating it here would test it twice and slow every run.

What lost:
- **Signing in through the login page**, with a fake Google behind it. It would need a fake OAuth server the browser can reach, which is a lot of machinery for a flow this test isn't about.
- **Importing `createDevSession` from the API's code.** That would tie the test's TypeScript to the API's internals. Running the script keeps the line between them a command and its output, and the API's own test pins the output.

## Prove the server kept it: wait, then a fresh browser

The test waits for the cancel's `PATCH` to answer 200 before reloading, and after the reload opens a second browser context with the cookie and nothing else.

Why: since #9 the app draws a saved copy the moment it opens ([[Offline reads]]). A reload alone could show stripes the server never kept. The fresh context has no copy, so what it shows came from the server. Waiting for the `PATCH` first keeps the test on the path it's about: had the reload cut the request off, the change would have been saved as a waiting change and sent again later, a different path ([[Offline cancels]]).

What lost:
- **Asking the API directly** (`GET /api/v1/calendar` from the test). It proves the database has the cancel, but not that a person would see it. The fresh browser proves both.
- **Waiting for the clock mark to go.** On a fast connection it never appears (it shows only after 2 s), so there's nothing to wait for.

## The bug it found: mark the restored copy stale

On its first run the test showed a week from before the change after the reload. The saved copy is written at most once a second, and a week fetched less than a minute ago counts as fresh, so the restored, out-of-date week wasn't fetched again. The fix saves every answer marked **invalidated**: restored, it's drawn at once and then fetched again (`savedAsStale`, [[Offline reads]]).

Why this fix: the saved copy is always from an earlier moment, so treating it as "possibly behind" is simply true. It costs one request per visible week when the app opens, and offline that request fails at once, as it already did for any copy older than a minute.

What lost:
- **Saving at once instead of once a second** (`throttleTime: 0`). A refetch of ten queries would be ten writes, and it still couldn't promise the last write lands before the app closes.
- **Saving when the page is closed** (`pagehide`). Browsers don't promise to finish a write started then, least of all on a phone that kills the app.
- **Making the test wait a second before reloading.** The test would pass, and the bug would stay for everyone else.

The review found the same gap in the queue of waiting changes: it was also saved at most once a second, so an offline cancel followed by closing the app within that second was lost. That was fixed in the same PR, on its own branch (`fix/queue-saved-at-once`), by saving the queue at once, every time (`throttleTime: 0`). It's the option rejected above for the reads, and it fits the queue for two reasons: nothing can fetch a lost change back, and the queue holds no reads, so a write is a few hundred bytes ([[Offline cancels]]).

## One browser, phone-sized

Chromium only, at 412 × 915.

Why: that's the app's main screen, a phone, and at that width the calendar shows one day, so today's Pottery is the only block. Firefox and Safari would triple the run time for a test about our wiring, not about browser differences.

What lost:
- **A browser matrix** (Chromium, Firefox, WebKit). Worth it when browser quirks are the risk; here the risk is our own pieces.

## Check yourself

- Why would naming the script `test` instead of `e2e` make every `pnpm test` slower, and what else would it need to run?
- The test's database is emptied before each run, not after. What do you lose and gain by emptying it after instead?
- Give the bug the fresh-browser step guards against, in one sentence, and say why waiting for the `PATCH` alone doesn't rule it out.
- The fix makes every app open fetch the visible week again. Why is that acceptable offline?
