# Testing pure code

> **Builds on:** nothing. A starting point.

A **pure function** gives the same output for the same input and changes nothing outside itself: no database, no network, no clock, no randomness. The recurrence engine is pure on purpose (D-015), and that makes it the easiest kind of code to test thoroughly. This note covers the five kinds of test used on it (`packages/core/src/recurrence/*.test.ts`). Strategy: D-017.

## 1. Example tests

One input, one expected output, written by hand.

*From `packages/core/src/recurrence/dates.test.ts`:*
```ts
  it('E4: every 3 days, counted from the series start rather than the window start', () => {
    const s = series({ rule: { freq: 'daily', interval: 3 }, startDate: '2026-10-05' });
    expect(expandDates(s, { from: '2026-10-09', to: '2026-10-20' })).toEqual([
      '2026-10-11',
      '2026-10-14',
      '2026-10-17',
      '2026-10-20',
    ]);
  });
```

- `it('…', () => { … })` is one test: a name, then a function Vitest runs. `expect(x).toEqual(y)` fails the test if `x` and `y` differ in any detail.
- The window starts on 9 Oct, but the answer starts on 11 Oct (5 + 3 + 3), not on 9 or 12. That's the bug this test exists to catch: counting "every 3 days" from the window instead of from the series.

- Most are numbered after the case tables in `docs/brainstorm/01` §7 (E = expansion, O = overrides, H = holidays, S = splits, T = time zones), so test and design doc point at each other.
- `src/test/builders.ts` has small factories (`series()`, `cancel()`, `move()`, …) with sensible defaults, so each test only states what matters to it.
- **When I got one wrong:** the first draft expected the 10th Mon/Wed/Fri class from 5 Oct to be 23 Oct. The engine said 26 Oct, and the engine was right (three a week: 9th is the 23rd). A failing test means "the code and the test disagree", not automatically "the code is wrong". Work it out by hand.

## 2. Property tests (fast-check)

Instead of picking inputs, state a rule that must hold for **every** input, and let the library generate 1,000 random ones (`src/test/arbitraries.ts` describes what "random" means here: rules, series, groups, overrides, holidays).

| Property | Says |
|---|---|
| E9 window additivity | Expanding 1–31 Oct equals expanding 1–15 Oct plus 16–31 Oct. Catches occurrences lost or doubled at window edges, including moves across them |
| Determinism | Shuffling the input arrays never changes the output |
| Cancel locality | Cancelling one occurrence changes that occurrence and nothing else |
| S5 split no-op | Splitting a series with no changes leaves every occurrence where it was |
| E11 well-formed | Dates ascend, never repeat, stay in the window, and match the rule |
| T6 | In Kolkata, the local start always equals the stored time |

E9, the first row, is short enough to read whole:

*From `packages/core/src/recurrence/properties.test.ts`:*
```ts
  it('E9: expanding a..c equals expanding a..b plus b+1..c, moves and extras included', () => {
    fc.assert(
      fc.property(world, threeDays, (w, [a, b, c]) => {
        const at = (from: Temporal.PlainDate, to: Temporal.PlainDate) =>
          expand({ ...w, window: { from: from.toString(), to: to.toString() } });
        const whole = at(a, c);
        const parts = [...at(a, b), ...at(b.add({ days: 1 }), c)];
        expect(parts.sort(byKey)).toEqual(whole.sort(byKey));
      }),
    );
  });
```

- `world` and `threeDays` come from `src/test/arbitraries.ts`: recipes for a random timetable and three random dates in order. fast-check calls the function 1,000 times with fresh values from them.
- `[a, b, c]` unpacks the three dates. The test never knows what the timetable *should* produce; it only checks that one big window and two halves agree.
- Both lists are sorted by key before comparing, because the two halves come back in a different order from the whole.

**Shrinking.** When a property fails, fast-check reduces the input to the smallest one that still fails. On the first run, S5 failed, and the shrunk example was a single Monday series with a cancel on a *Tuesday*. That override was already an orphan before the split, so my property ("a split creates no orphans") was too strong; the corrected one is "a split creates no **new** orphans". Properties test your understanding as much as the code.

## 3. Differential test (an oracle)

`oracle.test.ts` runs random daily/weekly rules through our engine **and** through `rrule-temporal`, an independent full implementation of the standard, and demands identical dates. Two programs written by different people rarely share a bug. One known difference is handled explicitly: the standard always counts the start date as an occurrence even if it's off-pattern; we don't, so the test keeps the start on-pattern.

## 4. Golden files

`golden.test.ts` renders two whole weeks of a made-up sample timetable as plain text and compares them with `__snapshots__/*.txt`. You can read the file and check it against a real week. Any behaviour change shows up as a readable diff. If a change is intended, regenerate with `vitest -u` **and read the new file** before committing it. The sample is made up on purpose: the repo is public, and your real timetable is personal data. It lives in `private/` (git-ignored) and reaches your own database through a seed in v0.2.

## 5. The `TZ` matrix

`pnpm test:tz` runs the tests under three machine time zones. The output must not change, because core never uses the machine's zone. See [[Time zones and daylight saving]].

## Coverage

`pnpm coverage` reports which lines and **branches** (each side of every `if`, `?:` and `??`) the tests executed. It's gated at 90% of branches on `src/recurrence/` only (currently 98%; 102 tests on 2026-10-12). Coverage shows what's *untested*; it doesn't prove what's tested is *right*. That's what the properties and the oracle are for.

## Did the tests actually test anything? (mutation check)

A test suite that can't fail is useless. To check, I disabled pass 2 of `expand` (occurrences moved into a window) and reran: two example tests (O3, O4) and the additivity property failed, the property after 82 random cases. Then I restored the code. You can do this yourself with any line: break it, predict which tests fail, run them. It's the best way to learn what each test is for.

## Check yourself
- Why are pure functions easier to test than a function that reads the database?
- Window additivity caught a broken pass 2. Explain *why* it would: what happens to an occurrence moved from 10 Oct to 20 Oct when you expand 1–15 and 16–31 separately?
- 100% branch coverage and a bug can coexist. Give an example.
- What should you do before running `vitest -u` to update a golden file?
