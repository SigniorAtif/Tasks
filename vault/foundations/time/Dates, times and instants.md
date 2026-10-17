# Dates, times and instants

> **Builds on:** nothing. A starting point.

Most calendar bugs come from mixing up three different kinds of "time". The app keeps them apart, in the types, in the database and on the wire (D-025, D-035).

## The three kinds

| Kind | Example | Means | Our type | Postgres |
|---|---|---|---|---|
| **Instant** | `2026-10-05T04:30:00Z` | One moment for the whole planet | `Instant` | `timestamptz` |
| **Local date** | `2026-10-05` | A box on a wall calendar. *When* it starts depends on where you are | `ISODate` | `date` |
| **Wall-clock time** | `10:00` | What the clock on the wall shows. Needs a date and a zone to become a moment | `WallTime` | `time` |

Plus the **zone** that connects them: an **IANA time-zone name** such as `Asia/Kolkata` or `America/New_York`.

- An IANA zone is a *rule book*, not an offset. `America/New_York` is −05:00 in winter and −04:00 in summer. The rule book knows when it switches, and it's updated when governments change the rules.
- `+05:30` is only an offset: it can't tell you what happens next March.
- `IST` is ambiguous (India, Israel and Ireland all use it).
- The engine rejects both. Temporal already throws on `IST`, but it *accepts* `+05:30` as a fixed zone, so `expand` has its own check (`assertZoneName` in `expand.ts`).

## Which kind for what

- **A class "every Monday at 10:00"** is a *rule* about wall clocks: local dates + `10:00` + `Asia/Kolkata`. We store exactly that, never an instant. A 10:00 class in London is `09:00Z` in summer; if we stored `09:00Z`, it would show at 09:00 local after the clocks go back in October. India has no daylight saving, so you'd never see that bug here, which is exactly why it's designed out from the start. See [[Time zones and daylight saving]].
- **A moment something happened** (a timer started, a class was confirmed) is an instant.
- **An occurrence** is computed: the engine turns *local date + wall time + zone* into instants for the calendar to draw.

In our database, a class is stored exactly that way. The `series` table, from the migration that created it:

*From `apps/api/drizzle/0001_calendar_tables.sql` (shortened):*
```sql
CREATE TABLE "series" (
	-- …
	"start_date" date NOT NULL,
	"until_date" date,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"tzid" text NOT NULL,
	-- …
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
```

- `date` and `time` are the local kinds: no zone, no offset. `tzid` holds the zone *name* as text (`Asia/Kolkata`).
- The only instant on the row is `created_at`, "when was this row made", which really is one moment for the whole planet. Postgres's `timestamp with time zone` is the long name of `timestamptz`.
- There's no column for "the start of the class as a moment". That is worked out each time from the three columns above.

## On the wire

- Instants are written in **RFC 3339**: `2026-10-05T10:00:00+05:30` or `2026-10-05T04:30:00Z`. Same moment, different notation. `Z` means UTC ("Zulu").
- The API accepts any offset and always answers in UTC `Z`. One spelling per moment makes comparisons and tests simple; the client converts to your zone for display.
- Date ranges of local dates are **inclusive** (`from` and `to` are both in), because that's how people say them ("5 to 11 October"). Ranges of instants are **half-open**, `[start, end)`: a class ending at 11:00 and the next starting at 11:00 don't overlap.

## 12-hour or 24-hour is display only

Every time in the data is written the 24-hour way: a series starts at `"14:00"`, an instant is `2026-10-12T08:32:00Z`. Whether you *see* "14:00" or "2:00 pm" is decided at the very last step, when the screen formats it. Our app shows 12-hour times (B11):

```ts
Temporal.PlainTime.from('14:00')
  .toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });   // "2:00 pm"
```

(`en-IN` writes "pm" in lower case; `en-US` writes "PM". The language setting decides the look, never the data.)

The calendar's real formatter uses `en-US`, which is why blocks read "10:00–11:00 AM". It also names the zone to show the time in:

*From `apps/web/src/calendar/model/format.ts` (shortened):*
```ts
    clock = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
```

`Intl.DateTimeFormat` is the browser's built-in formatter. It's given an instant and `timeZone: zone` (your profile's zone), so a phone or laptop left on another zone still shows a Kolkata class at its Kolkata time.

What follows from it:
- **Never store or send "2:00 pm".** `"14:00"` sorts correctly as plain text and can't be misread; "12:30 am" (just after midnight) confuses people and code alike.
- **Never turn a formatted time back into data.** The form's time picker hands over `"14:00"`, whatever it shows on screen.
- **The format can change without touching anything else:** a 24-hour setting later, or another language, changes only the formatting call. The API, the database and the engine's tests stay as they are.

## Why not JavaScript's `Date`

`Date` is really an instant wearing a disguise. `new Date(2026, 9, 5)` silently uses the *machine's* time zone, so the same code gives different results on your laptop (IST), a UTC server and a phone in New York. It has no "just a date" and no "just a time".

**Temporal** is the replacement built into JavaScript's standard: `PlainDate` (a date), `PlainTime` (a time), `ZonedDateTime` (date + time + zone), `Instant` (a moment). Every type says exactly what it means. We import it from `temporal-polyfill` because not every runtime ships it yet (Safari doesn't; this machine's Node doesn't). In `packages/core`, `Date` is banned by the linter: see [[Tooling choices]].

## Check yourself
- Your class is "Mondays at 10:00 in Kolkata". Why is storing `04:30Z` for it wrong, even though it's correct for every Monday this year?
- Are `2026-10-05T10:00:00+05:30` and `2026-10-05T04:30:00Z` the same instant? Which one does our API send back?
- Why does a range of instants use `[start, end)` instead of including both ends?
- The series form shows "2:00 pm". What exact text does the API receive for `startTime`, and why not "2:00 pm"?
