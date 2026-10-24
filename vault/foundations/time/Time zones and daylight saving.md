# Time zones and daylight saving

> **Builds on:** [[Dates, times and instants]]

**Daylight saving time (DST)** is when a country moves its clocks forward one hour in spring and back in autumn. India doesn't, so none of this will ever happen to your timetable. It matters anyway, for two reasons: the engine must be right for any zone, and "correct only in India" bugs stay invisible until someone else uses the app.

## The two awkward nights

**The gap (spring forward).** New York, 8 March 2026: at 02:00 the clock jumps to 03:00. The wall-clock time **02:30 doesn't exist** that night.

**The overlap (fall back).** New York, 1 November 2026: at 02:00 the clock goes back to 01:00. **01:30 happens twice**, first at −04:00, then an hour later at −05:00.

A daily "02:30" or "01:30" series has to do *something* on those nights.

## What we do (D-025)

We follow Temporal's `'compatible'` rule, which is also what most calendar apps do:

| Night | Rule | Example (New York) |
|---|---|---|
| Gap | Push forward by the length of the gap, and set `dstShifted: true` | 02:30 → **03:30** (−04:00) |
| Overlap | Take the **first** of the two | 01:30 → 01:30 **−04:00** |

The RFC 5545 standard (iCalendar) says an occurrence inside a gap should be **dropped**. `rrule-temporal` follows that, and we deliberately don't. Silently losing a class or a run is worse than shifting it, and the flag lets the UI show a small "DST" hint.

Here's the gap row as a test in our engine: a daily 02:30 series in New York, around the spring-forward night.

*From `packages/core/src/recurrence/dst.test.ts` (shortened):*
```ts
    const occs = occurrences(s, '2026-03-07', '2026-03-09');
    expect(occs.map((o) => [o.key, local(o.start, o.tzid), o.dstShifted])).toEqual([
      ['s:2026-03-07', '2026-03-07T02:30:00-05:00', false],
      ['s:2026-03-08', '2026-03-08T03:30:00-04:00', true],
      ['s:2026-03-09', '2026-03-09T02:30:00-04:00', false],
    ]);
```

Read the three rows. 7 March is at 02:30 (−05:00, winter). 8 March is pushed to **03:30** and flagged `true`. 9 March is back at 02:30, now at −04:00 (summer). The key still says `2026-03-08`: the occurrence keeps its identity even though its time moved.

Other cases the tests pin down (`packages/core/src/recurrence/dst.test.ts`):
- **Lord Howe Island** (Australia) moves its clocks by **30 minutes**, so 02:15 → 02:45. The rule says "by the length of the gap", not "by an hour".
- **Samoa skipped a whole day**: 30 December 2011 never existed there. A daily 10:00 series lands on 31 December for that occurrence, and its key still says `2011-12-30`. So 31 December has two occurrences with different keys. Odd, correct, and tested.

## Duration across a change

`end = start + duration`, in **real elapsed minutes**. A 60-minute class starting at 01:30 (−04:00) on the fall-back night ends at 01:30 (−05:00): the wall clock shows the same time twice, but exactly 60 minutes passed. The other choice ("end at the wall-clock time 02:30") would make the class last two hours. For attendance and time tracking, real time is what counts.

## A day isn't always 24 hours

On the two awkward nights, the local *day* changes length too. In New York, 8 March 2026 lasts **23 hours** and 1 November 2026 lasts **25** (Temporal's `hoursInDay` reports both). In Kolkata every day is 24 hours, so code that assumes "a day = 24 hours" passes every test here and breaks everywhere else.

The classic bug: draw a week by starting at Monday 00:00 and adding 24 hours, seven times. In New York, 00:00 on 1 November plus 24 hours is **23:00 the same day**, so the next "day" starts an hour early, and everything after it is drawn an hour off. Instead, walk **local dates** and ask each one when it starts:

```ts
const day = Temporal.PlainDate.from('2026-11-01');
const start = day.toZonedDateTime('America/New_York');                // 2026-11-01T00:00-04:00
const next = day.add({ days: 1 }).toZonedDateTime('America/New_York'); // 2026-11-02T00:00-05:00
// 25 hours apart on this date, 24 on most, 23 on 8 March
```

A `PlainDate` turned into a `ZonedDateTime` this way lands on the first moment of that local day, and `zdt.startOfDay()` does the same for a moment you already have. Both also handle zones where midnight itself gets skipped: São Paulo's clocks jumped from 00:00 to 01:00 on 4 November 2018, so that day started at 01:00.

The calendar grid does exactly this when it cuts each occurrence into one piece per visible day ([[Calendar grid]]):

*From `apps/web/src/calendar/model/segments.ts` (shortened):*
```ts
const startOfDay = (day: Temporal.PlainDate, zone: IanaZone) =>
  day.toZonedDateTime({ timeZone: zone });
// …
    for (; Temporal.PlainDate.compare(day, lastDay) <= 0; day = day.add({ days: 1 })) {
      const dayStart = startOfDay(day, zone);
      if (compare(dayStart, end) >= 0) break; // it ended before this day began
      const nextDayStart = startOfDay(day.add({ days: 1 }), zone);
```

The loop steps through `PlainDate`s (`day.add({ days: 1 })` is always the next calendar day) and asks for each day's start separately. Nothing ever adds 24 hours, so a 23- or 25-hour day comes out right on its own.

## A zone isn't an offset

`Asia/Kolkata` is a rule book that says "+05:30, always". `America/New_York` says "−05:00, except −04:00 between these dates". A raw offset like `+05:30` can't change, so a series stored with `-05:00` would be an hour wrong all summer. That's why the engine accepts only IANA names.

## How we test it without travelling

- Examples use specific zones: New York, London, Lord Howe, Samoa.
- A property test: in Kolkata, the local start always equals the stored time, and `dstShifted` is always false.
- **The `TZ` matrix:** `pnpm test:tz` runs the core and web tests three times, with the *machine's* zone set to UTC, Asia/Kolkata and America/New_York. The engine never uses the machine's zone, so all three runs must produce byte-identical golden files. If someone sneaks in code that depends on the host zone (the classic `Date` bug), one of the three runs breaks.

## Check yourself
- A daily run is at 02:30 in New York. What time does it show on 8 March 2026, and what tells the UI it was moved?
- Why might a calendar prefer dropping the 02:30 occurrence, and why did we decide shifting is better for this app?
- Your laptop is in IST. Why would a bug that uses the machine's time zone pass every test on your laptop but fail in CI?
- A week view starts at Monday 00:00 in New York and adds 24 hours per day. On the week of 1 November 2026, which day's blocks are drawn wrong, and by how much?
