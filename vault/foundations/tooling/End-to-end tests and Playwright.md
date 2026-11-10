# End-to-end tests and Playwright

> **Builds on:** [[Testing pure code]] · [[Integration tests]] · [[Single-page apps and routing]]

[[Testing pure code]] checks one function at a time: call it, compare its answer. [[Integration tests]] check several real pieces together on the server: a request goes into our routes, through Better Auth and Drizzle, into a real Postgres. Neither one opens the app. An **end-to-end test** does: a real browser loads the real built app, a script taps and types the way you would, and it reads the screen to check what happened. Every layer takes part, from the button down to the database row and back.

## What it catches that the others can't

Each kind of test trusts the pieces it doesn't run. The web app's unit tests trust that the API answers the way `packages/core` says it will. The API's integration tests trust that the web app sends what the schema allows. An end-to-end test trusts nothing between the screen and the database, so it catches bugs that live in the **wiring**: two pieces, each correct on its own, that go wrong together.

Our first end-to-end test found exactly that kind of bug on its first run ([[End-to-end test]]). The saved copy of the cache was correct. The calendar's one-minute freshness rule was correct. Together, a reload within a second of a change showed a week from before it. Every unit test passed, because no unit test had both pieces in it.

## What it costs

- **Time.** A unit test takes a millisecond. Ours takes about 3 seconds, plus a few more to start the server, plus a build of the app before that.
- **Moving parts.** It needs a browser, the built app, the API and a database, all running at once.
- **Vague failures.** "The block never appeared" could be a bug in the form, the API, the database or the test. A unit test that fails points at one function.
- **Flakiness.** A **flaky** test passes and fails on the same code, usually because of timing (the script looked before the page was ready) or shared state (a leftover from the run before). A flaky test is worse than none: after a few false alarms everyone ignores it, including on the day it's right.

So you keep them few and aim them at the paths that matter most, and you push edge cases down to unit tests, where they're cheap. The plan for this app allows at most six end-to-end tests by v1.5; v0.3 has one. People draw this as a **test pyramid**: many unit tests at the bottom, fewer integration tests above, a handful of end-to-end tests at the top.

| Kind | Runs | One test takes | Finds |
|---|---|---|---|
| Unit | one function, in Node | ~1 ms | wrong logic in that function |
| Integration | the API and a real Postgres | ~10–100 ms | wrong SQL, wrong status codes, missing checks |
| End-to-end | a browser, the built app, the API and Postgres | seconds | pieces that don't fit together |

## Playwright

**Playwright** is a library, made by Microsoft, that drives a real browser from a script: Chromium (the open-source core of Chrome), Firefox or WebKit (the core of Safari). It talks to the browser through the browser's own debugging protocol, the same one DevTools uses. Its test runner, the package `@playwright/test`, adds `test`, `expect`, a config file and reports.

Three objects, from the outside in:

| Object | What it is | Like |
|---|---|---|
| **Browser** | One running browser program | Opening Chrome |
| **Browser context** | A fresh, empty profile inside it: its own cookies, `localStorage`, IndexedDB and service workers, sharing nothing with any other context | A new incognito window |
| **Page** | One tab in a context | A tab |

A context is cheap to make, so every test gets a brand-new one, and nothing one test saved can leak into the next. A test can also make a second context on purpose: a second "device" with nothing saved. Our test does that to prove the server kept a change ([[End-to-end test]]).

The runner hands each test what it asks for. `async ({ page, context, browser }) => …` gets a page, the context it lives in, and the browser. These are **fixtures**: things the runner sets up before the test and tears down after it.

## Finding things the way a person does

A **locator** describes how to find an element. It doesn't find it yet; it looks each time it's used, so the same locator still works after the page reloads.

```ts
page.getByRole('button', { name: 'Save' });
page.getByLabel('Title', { exact: true });
```

`getByRole` finds an element by its **role** (button, link, dialog) and its **accessible name**, the words a screen reader would say for it. That's how a person finds things too: "the Save button", not "the third `<button>` in the second `<div>`". A test written this way doesn't break when the layout changes, and it fails when a button loses its label, which is a real bug for anyone using a screen reader. Locators are also **strict**: if one matches two elements, the action fails instead of picking one, since a test that can't tell what it clicked can't be trusted.

## Waiting without sleeping

The old way to wait for a page was `sleep(2000)` and hope. Too short and the test flakes; too long and every run is slow. Playwright waits for the thing itself:

- **Actions wait.** `click()` waits until the element exists, is visible, stops moving and can receive the click. Then it clicks.
- **`expect` retries.** `await expect(block).toHaveAccessibleName(/I skipped$/)` checks again and again until it's true or 5 seconds pass. Only then does it fail.
- **Events can be awaited.** `page.waitForResponse(test)` resolves when the page receives a network response that passes `test`. Start waiting *before* the click that causes it, or the response may arrive before anyone is listening.

## Starting the server

The test needs the app running. In the config, `webServer` names a command; Playwright runs it before the tests, waits until a URL answers, and stops it when the tests end. That way `playwright test` works on a fresh machine with nothing already running.

## When it fails

A failed test can keep a **trace**: a recording of every step, with a snapshot of the page before and after each action, every network request, and the console. `playwright show-trace <file>` opens it in a viewer where you can step through the run. It answers the question a failure message can't: what did the page actually look like? Our first failure was read from the trace's network log: after the reload, no week was fetched.

## Headless

**Headless** means the browser runs with no window. It renders the page the same way, but draws nothing on a screen, which is what a CI machine needs (it has no screen). Playwright downloads its own build of each browser, pinned to its version, so every machine runs the same one. For Chromium there's a smaller **headless shell**, which is all a headless run needs.

## Check yourself

- Our unit tests, integration tests and end-to-end test all passed before v0.3, yet the end-to-end test failed on its first run. Explain how a bug can hide from every unit test and still be real.
- Why does every Playwright test get a new browser context, and what would go wrong if two tests shared one?
- A test does `await page.getByRole('button', { name: 'Save' }).click()` and the form has two Save buttons. What happens, and why is that better than clicking the first?
- You write `await page.click(…); const response = await page.waitForResponse(…)`. Why can this hang, and how do you fix it?
- A test failed once in CI and passed when re-run. Name two likely causes, and say why re-running until it passes is the wrong fix.
