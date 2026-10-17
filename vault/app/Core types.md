# Core types (`packages/core/src/types.ts`)

> **Background:** [[TypeScript essentials]] · [[TypeScript checking vs running]] · [[Dates, times and instants]]

The single source of names (D-015). The brainstorm slices produced seven spellings of the cancel reasons and three formats for occurrence keys; this file is where each name is decided once. The API, the web app and the CLI all import from here. A new name goes here first.

Time vocabulary first: [[Dates, times and instants]].

## In plain words: the app's dictionary

`types.ts` is one file that describes the *shapes* of our data, with no logic in it. It holds descriptions, not variables. For example, a "Series" always has a title, a rule, a start time, a duration and a time zone.

Why one place: the design docs spelled the same idea seven different ways (`prof_cancelled`, `not_held`, `prof`…). If the server sends `not_held` and the app expects `prof`, things break silently. With one file, every part of the app uses the same names, and TypeScript refuses a typo before the code ever runs. Think of it as the app's dictionary.

It does nothing when the app runs. When TypeScript strips the types (see [[TypeScript checking vs running]]), this file becomes empty. Its whole job happens at check time.

## Predict first

Before reading the file: how would you represent "DBMS, Mon/Wed/Fri 10:00, except next Wednesday is cancelled"? What's stored, and what's computed?

## What's in it

| Name | What it is |
|---|---|
| `ISODate`, `WallTime`, `IanaZone`, `Instant` | The time kinds, all strings. They're *aliases*: TypeScript treats them as `string`, but the name tells the reader which format |
| `DateWindow` | `{ from, to }`, both included |
| `Weekday`, `Rule` | The recurrence rule: `{ freq: 'daily', interval }` or `{ freq: 'weekly', interval, byDay }` (D-024) |
| `ScheduleGroup` | "Classes · Sem 3": colour (a `ColorToken`, one of the ten palette names, since v0.2), active date range, attendance settings, `observesHolidays` |
| `Series` | One timing pattern: rule + start date + wall-clock start + duration + zone. Also title, subject, room |
| `OccurrenceOverride` | What you said about one occurrence. Two kinds: `ModifiedOverride` (changes a generated occurrence) and `ExtraOverride` (a make-up class the rule never generated). Either can carry a free-text `note` |
| `DayException` | A holiday or day off: one row per day, with an `effect` |
| `CancelReason`, `CancelOrigin` | `not_held` / `skipped`, and `user` / `holiday` (D-027) |
| `OccurrenceKey` | `seriesId:originalDate`, or `x:overrideId` for extras (D-022) |
| `Occurrence` | One computed occurrence, ready to draw. Never stored |
| `SessionKind`, `SessionSource` | Reserved for v1/v3 so the names don't fork later (D-050) |

Stored: groups, series, overrides, day exceptions. Computed: occurrences. That split is D-021: "rules plus sparse overrides, expanded on read".

The first row (and the `OccurrenceKey` row) as they're written in the file. Each time kind is just `string` under a more telling name, with a comment that says the format:

*From `packages/core/src/types.ts` (shortened):*
```ts
/** A local calendar date, `YYYY-MM-DD`. No time, no zone. */
export type ISODate = string;

/** A local wall-clock time, `HH:MM` (Postgres may return `HH:MM:SS`). No date, no zone. */
export type WallTime = string;

/** An IANA time-zone name such as `Asia/Kolkata`. Never `IST` and never `+05:30`. */
export type IanaZone = string;

/** One moment in time, RFC 3339. Accepted with any offset; always sent back in UTC (`...Z`). */
export type Instant = string;
// …
export type OccurrenceKey = `${string}:${string}`;
```

What to notice:
- `type ISODate = string` creates no new type. TypeScript lets you pass any string where an `ISODate` is expected; the name is for the reader, and the `/** … */` comment shows up when you hover it in the editor.
- They're strings, not Temporal objects, so they travel through JSON and the database unchanged. The engine turns them into Temporal values inside (see [[Recurrence engine]]).
- `OccurrenceKey` is a *template literal type*: any string with a `:` in it, like `dbms:2026-10-07` or `x:<id>`. A plain `'hello'` is refused.

## Three TypeScript ideas used here

(All three, and the rest of the TypeScript this repo uses, are explained from zero in [[TypeScript essentials]].)

**Union of string literals.** `type CancelReason = 'not_held' | 'skipped'` allows exactly those two strings. A typo like `'not-held'` is a compile error, so the seven spellings can't come back.

*From `packages/core/src/types.ts` (shortened):*
```ts
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
// …
/** Stored meaning of a cancellation. UI labels: "Prof cancelled" / "I skipped" (D-027). */
export type CancelReason = 'not_held' | 'skipped';

/** Who cancelled: the user on this one occurrence, or a day exception (holiday, day off). */
export type CancelOrigin = 'user' | 'holiday';
```

The stored value (`not_held`) and the label you see ("Prof cancelled") are different things on purpose: the label can be reworded later without touching a single stored row.

**Discriminated union.** `Rule` and `OccurrenceOverride` are each "one of several shapes", told apart by one field (`freq`, `kind`). After `if (rule.freq === 'weekly')`, TypeScript knows `rule.byDay` exists. Impossible states can't be written: a daily rule with `byDay`, or an extra without a time.

```ts
export type OccurrenceOverride = ModifiedOverride | ExtraOverride;
// ModifiedOverride: kind 'modified', originalDate is a date, newDate may be null
// ExtraOverride:    kind 'extra',    originalDate is null,  newDate is required
```

The real declarations:

*From `packages/core/src/types.ts` (shortened):*
```ts
export type Rule =
  | { freq: 'daily'; interval: number }
  | { freq: 'weekly'; interval: number; byDay: Weekday[] };
// …
export interface ModifiedOverride extends OverrideFields {
  kind: 'modified';
  /** The date the rule generated. This is the occurrence's identity (D-022). */
  originalDate: ISODate;
  /** Move to another day. */
  newDate: ISODate | null;
  /** Move to another time. */
  newStartTime: WallTime | null;
}

/** A one-off occurrence the rule never generated, such as a make-up class (D-031). */
export interface ExtraOverride extends OverrideFields {
  kind: 'extra';
  originalDate: null;
  newDate: ISODate;
  newStartTime: WallTime;
}

export type OccurrenceOverride = ModifiedOverride | ExtraOverride;
```

What to notice:
- `kind: 'modified'` and `kind: 'extra'` are single-string types. That one field is the *discriminant*: check it, and TypeScript knows which of the two shapes you hold.
- In `ExtraOverride`, `newDate` and `newStartTime` have no `| null`. That is "an extra without a time can't be written".
- `extends OverrideFields` copies in the shared fields (status, duration, note…), shown next. See [[TypeScript essentials]] for `interface` and `extends`.

This mirrors the database rule from `docs/brainstorm/01` §5.3: `check ((kind = 'extra') = (original_date is null))`.

**`null` means "inherit".** Every override field is nullable. `status: null` means "whatever the series and the day layer say", not "scheduled". This is *patch* semantics: an override that only changed the duration keeps following the series if its start time changes later. The opposite, copying every field into the override ("snapshot"), freezes stale values. It's the classic way calendars lose edits (01 §6 trap 5).

*From `packages/core/src/types.ts` (shortened):*
```ts
interface OverrideFields {
  id: string;
  seriesId: string;
  /** `null` = inherit (scheduled, unless a day exception cancels it). */
  status: 'scheduled' | 'cancelled' | null;
  /** Only meaningful when `status` is `cancelled`. `null` in groups without attendance. */
  cancelReason: CancelReason | null;
  durationMin: number | null;
  // …
}
```

Three values for `status`, three meanings: `'cancelled'`, `'scheduled'`, and `null` for "no opinion: ask the layers below". A plain on/off field would have had no way to say "no opinion".

We use `null` rather than optional `?:` fields for stored data, because the database and JSON both have a real `null`. Optional fields are for "not sent at all".

## Where I changed the plan's draft, and why

The draft in `00-overview.md` §5 was the starting point. Changes, for you to agree or push back on:

1. **`Occurrence.status` is `scheduled | cancelled`, plus a separate `moved: boolean`.** The draft had `status: 'scheduled' | 'cancelled' | 'moved'`. But "moved" and "cancelled" aren't exclusive: a class moved to Saturday can then be cancelled. As one field, you'd have to pick which fact to lose.
2. **`OccurrenceOverride` has an `id`, a `kind`, and a nullable `status`.** The draft had no id (so extras had nothing to build `x:<id>` from), put "extra" inside `status` (so an extra class couldn't be cancelled), and made `status` required (so it couldn't mean "inherit", and a duration-only edit would have blocked a later holiday).
3. **`Occurrence` gained `date`, `tzid`, `subject`, `location`, `extra`, `holidayLabel`, `confirmedAt` and (on 2026-10-12) `note`.** `date` is where it happens after a move (the draft only had `originalDate`); `tzid` says which zone `date` is local to; the others carry what the calendar and the attendance view need. The draft's `origin` became `cancelOrigin` and `dstShifted` stayed.
4. **`ScheduleGroup.observesHolidays`.** The engine needs to know which groups a holiday cancels. The critique planned it "with the holiday layer", and the holiday layer is in the engine now.
5. **`Series.location`.** A class has a room. It was in 02's schema and D-020's fixture format but missing from the draft.

Things I deliberately left out (each is additive later): a `deleted` status (01's "this class never existed"), title/room overrides on one occurrence, `busy` on groups (needed for conflicts in v0.3b), and `userId` (a database concern, not part of these shapes).

## The `note` field (added 2026-10-12)

`OverrideFields.note: string | null`, copied to `Occurrence.note`. It's the one override field that isn't a patch: the series has no note, so `null` means "no note", not "inherit". It matches the `note text` column in `docs/brainstorm/01` §5.3 and 02.

It's **inert**: it never changes when or whether the occurrence happens. So it must not count as "placing" the occurrence the way a new date or time does. Otherwise writing "Essay still due" on a class would stop a later holiday from cancelling it.

The type carries that rule in its comment, so whoever adds the next field reads it:

*From `packages/core/src/types.ts` (shortened):*
```ts
interface OverrideFields {
  // …
  /**
   * Free text on this one occurrence: "Bring the lab manual". The series has no note to
   * inherit, so `null` simply means "no note". It never changes when or whether the
   * occurrence happens: a note-only override still lets a holiday cancel the class.
   */
  note: string | null;
}
```

The type can't *enforce* "inert"; the engine does, by leaving `note` out of its "placed" check ([[Recurrence engine]], "The layers for one occurrence").

No length limit in core: core passes text through as it is. The cap belongs in the database `CHECK` and the API schema. v0.2 created the `note` column but no route writes overrides yet, so the cap arrives with v0.3's override routes. The session notes in 02 use `<= 4000`; the same is a sensible default.

## The rest of `packages/core` (added in v0.2)

`types.ts` is the dictionary; v0.2 added four neighbours, all still pure (no I/O, no clock):

| File | What it holds | Read more |
|---|---|---|
| `src/palette.ts` | `COLOR_TOKENS` (`'blue'`, `'sky'`, … `'violet'`), the `ColorToken` type made from it, and `DEFAULT_COLOR_TOKEN` | [[Calendar grid]] |
| `src/schemas.ts` | The zod rules for every request body and the calendar window: `createSeriesSchema`, `updateGroupSchema`, `calendarQuerySchema`… The API parses requests with them; the form checks your input with the same ones | [[Validating input with schemas]], [[v0.2 contracts]] |
| `src/api.ts` | The HTTP contract: URL paths (`paths.calendar`…), response shapes (`GroupList`, `SeriesList`, `CalendarResponse`), error codes (now including `conflict`) | [[Calendar API]] |
| `src/timetable.ts` | The timetable file format and `timetableToRows`, which turns a file into the rows the API creates | [[Timetable files and seeding]] |

`palette.ts` shows a trick worth knowing: the list of colours is written once, as a value, and the type is *made from* the list, so the two can't drift apart:

*From `packages/core/src/palette.ts` (shortened):*
```ts
export const COLOR_TOKENS = [
  'blue',
  'sky',
  // …
  'violet',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
```

- `as const` makes TypeScript remember the exact strings (`'blue'`, `'sky'`…) instead of widening them to `string[]`.
- `(typeof COLOR_TOKENS)[number]` reads as "the type of any element of that array", which is `'blue' | 'sky' | … | 'violet'`. Add an eleventh colour to the array and the type grows with it.

A useful way to see the split: `types.ts` says what data **looks like**; `schemas.ts` says what input is **allowed**. A `Series` has a `durationMin: number`; only `createSeriesSchema` knows it must be a whole number from 1 to 1440.

```ts
// packages/core/src/types.ts: the shape
  durationMin: number;
// packages/core/src/schemas.ts: the rule for input
  /** Up to a whole day. */
  durationMin: z.number().int().min(1).max(1440),
```

`2.5`, `0` and `5000` are all a `number`, so TypeScript accepts them; the zod rule refuses all three before they reach the database ([[Validating input with schemas]]).

## Check yourself
- Why is `status: null` on an override different from `status: 'scheduled'`? Give a case where they behave differently. (Hint: a holiday.)
- What stops someone from creating an extra class without a time? Where is that enforced: TypeScript, the database, or both?
- `OccurrenceKey` uses the *original date*, not the start time. What breaks if you change "DBMS from 10:00 to 10:30 for all" and the key were the start time?
- `status: null` means "inherit". Why doesn't `note: null` mean "inherit" too?
