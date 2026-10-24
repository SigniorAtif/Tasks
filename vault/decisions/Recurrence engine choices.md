# Recurrence engine choices

The calls made while building v0.1. Most come from `docs/brainstorm/01` and `00-overview` §2.B. The ones marked **new** were made during the build, and they're open to your pushback. How it works: [[Recurrence engine]].

## Hand-written expander, not a library (D-024)

We wrote our own expander for daily and weekly rules (`ruleDates` in `dates.ts`, about 40 lines).

What lost: `rrule` (stale since 2023, and its results depend on the machine's time zone) and `rrule-temporal` (a full RFC 5545 engine: monthly, yearly, by-set-position and more).

We need two frequencies. A small engine is fully understood and fully tested, while a full one brings rules nobody uses and edge cases of its own (it drops DST-gap occurrences, which we don't want).

The safety net: `rrule-temporal` is a dev dependency used as a **test oracle**, and 1,000 random rules per run must give identical dates. If monthly rules are ever needed, it becomes the engine behind the same function.

## Dates first, times second

Expand with `PlainDate` (no times, no zones), then attach times and zones at the end. Daylight saving can't touch step 1, and the date key (D-022) falls out naturally.

## DST gap: shift forward and flag (D-025, B5)

The standard says drop the occurrence. We push it forward by the gap and set `dstShifted`, because losing a class silently is worse than moving it by an hour. See [[Time zones and daylight saving]].

## Precedence: override > day exception > series rule

From 01 §5.1. An explicit "it's on" survives a holiday added later.

## Which overrides block the holiday layer (**new**, confirmed 2026-10-10)

The day layer skips an occurrence the user explicitly *placed* (a new date or time) or gave a status. An override that only changes the duration doesn't block it.

A move is a deliberate decision about when the class happens. A duration tweak isn't a decision about *whether* it happens.

Your call (2026-10-10): this is the behaviour you want. If you reschedule a class onto a day, you're saying "this class happens", holiday or not.

The leftover edge case: you move a class's time on 20 Oct, and only *later* is 20 Oct declared a holiday. The class stays on the calendar, though in reality it's off. The engine can't tell which came first, because it doesn't store when each fact was recorded. The workaround is to cancel that one class by hand. The real fix, only if it bites, is to compare when the override and the holiday were created.

## Occurrence `date` is the scheduled local date (**new**)

On a night where the date itself doesn't exist (Samoa, 30 Dec 2011), `date` says 30 Dec while `start` is on 31 Dec. The window filter uses `date`, so windows tile perfectly (the additivity property), and `dstShifted` tells the UI something odd happened. It only matters for a handful of historical zone changes.

## Date windows are inclusive

`{from: '2026-10-05', to: '2026-10-11'}` is the whole week. That's how people say ranges, and how 01's tests are written. Instant ranges stay half-open, `[start, end)` (D-035). The 62-day cap (B7) is the API's job, not the engine's.

## Inputs: throw on caller bugs, ignore extra data (**new**)

The engine **throws** on a window ending before it starts, a series whose group is missing, an invalid rule, an unknown zone, or a raw offset zone. It **ignores** overrides for series that weren't passed in, so callers can fetch overrides broadly.

A missing group means we can't clip correctly, and a quietly wrong calendar is the worst outcome. An extra override is harmless.

## `expand` returns occurrences; orphans are a separate function (**new**)

01 had `resolveWindow` return both. But orphans are about a series as a whole, not a window, and only the split UI needs them (v0.3b). Two functions keep each one simple.

## `splitSeries`: same rule keeps its phase; a new rule starts at its first match (**new** detail)

01's sketch started a new rule *on* the split date. For "every 2 weeks on Thursday" split on a Friday, that anchors the phase to the Friday's week, so the first class would be 13 days away instead of 6. Starting at the first matching day is what a person means. A rule that's only written differently (`['MO','MO']` vs `['MO']`) counts as unchanged, so the phase isn't accidentally reset.

## The caller makes the new series' id

A UUIDv7 needs the clock and randomness, and core stays pure, so the API passes `newId` in.

## Not built yet (each is additive)

`toRRULE()` for an ICS export, monthly rules, "Saturday follows Monday's timetable" (day swaps, 00 §2.C C5), floating time zones for travel (B4), a `deleted` status, the attendance maths (v2), and conflict detection (v0.3b).

## Check yourself
- Name one thing `rrule-temporal` would give us for free, and one reason not to run it in the app.
- You moved Tuesday's class to 11:00, then the college declared Tuesday a holiday. What does the engine show, and what would fix it if that's wrong?
- Why does the engine throw when a group is missing, but ignore an override for an unknown series?
