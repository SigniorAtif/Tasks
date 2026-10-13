// Request schemas for the calendar routes (D-041). One definition, two users: the
// API parses request bodies and query strings with them, and the PWA's series
// form checks what the user typed with the very same rules before sending, so
// the two can never disagree about what's valid.
//
// Each schema turns untrusted input into a typed value or a list of field errors
// ("parse, don't validate"). Dates and times stay strings, like everywhere else
// in core; the checks parse them with Temporal to make sure they're real.
//
// Create schemas take a client-generated UUIDv7 `id` (D-034): a retried create
// sends the same id again, and the server answers with the row it already has
// instead of making a second one (D-042).

import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { COLOR_TOKENS, DEFAULT_COLOR_TOKEN } from './palette.ts';
import { MAX_INTERVAL } from './recurrence/dates.ts';
import type { Weekday } from './types.ts';

/** The widest window `GET /api/v1/calendar` answers, counting both ends (B7). */
export const MAX_CALENDAR_DAYS = 62;

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const satisfies readonly Weekday[];

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function isRealDate(value: string): boolean {
  try {
    Temporal.PlainDate.from(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * `YYYY-MM-DD`, and a day that exists (`2026-02-30` doesn't). The format check
 * aborts, so `13/10/2026` gets one message, not a second "not a real date".
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'must be a date like 2026-10-13', abort: true })
  .refine(isRealDate, 'is not a real date');

/** `HH:MM` on a 24-hour clock. Seconds aren't accepted: the calendar works in minutes. */
export const wallTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 09:30');

/**
 * An IANA zone name (D-025), returned in its canonical spelling (`asia/kolkata` →
 * `Asia/Kolkata`). Abbreviations like `IST` and raw offsets like `+05:30` are refused:
 * an offset never follows daylight saving, and abbreviations are ambiguous.
 */
export const ianaZoneSchema = z
  .string()
  .max(64)
  .transform((value, ctx) => {
    const fail = () => {
      ctx.addIssue({ code: 'custom', message: 'must be a time zone name like Asia/Kolkata' });
      return z.NEVER;
    };
    if (/^[+-]/.test(value)) return fail();
    try {
      return Temporal.ZonedDateTime.from({ year: 2026, month: 1, day: 1, timeZone: value })
        .timeZoneId;
    } catch {
      return fail();
    }
  });

export const colorTokenSchema = z.enum(COLOR_TOKENS);

/** A UUIDv7: time-ordered, so new rows land at the end of the index (D-034). */
const newIdSchema = z.uuidv7({ error: 'must be a UUIDv7' });

/** Any existing row's id. */
const idSchema = z.uuid({ error: 'must be a UUID' });

/** Trimmed text of 1 to `max` characters. */
const text = (max: number) => z.string().trim().min(1, 'must not be empty').max(max);

/** Optional free text: blank becomes `null`, so "no location" has one spelling. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

/** Days in `[from, to]`, counting both ends. Both are valid ISO dates. */
function daysInclusive(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(to, { largestUnit: 'days' }).days + 1;
}

// ---------------------------------------------------------------------------
// Rules (D-024)
// ---------------------------------------------------------------------------

/** Monday first, each day once, so equal rules are stored identically. */
function normaliseDays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day));
}

export const ruleSchema = z.discriminatedUnion('freq', [
  z.object({
    freq: z.literal('daily'),
    interval: z.number().int().min(1).max(MAX_INTERVAL.daily),
  }),
  z.object({
    freq: z.literal('weekly'),
    interval: z.number().int().min(1).max(MAX_INTERVAL.weekly),
    byDay: z.array(z.enum(WEEKDAYS)).min(1, 'pick at least one day').transform(normaliseDays),
  }),
]);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const activeRangeCheck = {
  check: (g: { activeFrom?: string; activeTo?: string | null }) =>
    g.activeFrom === undefined || g.activeTo == null || g.activeTo >= g.activeFrom,
  params: { path: ['activeTo'], message: 'must be on or after activeFrom' },
};

/** `POST /api/v1/groups`. */
export const createGroupSchema = z
  .object({
    id: newIdSchema,
    name: text(80),
    colorToken: colorTokenSchema.default(DEFAULT_COLOR_TOKEN),
    activeFrom: isoDateSchema,
    /** `null` = open-ended (a semester whose last day isn't known yet). */
    activeTo: isoDateSchema.nullable().default(null),
    observesHolidays: z.boolean().default(true),
    attendance: z.boolean().default(true),
    attendanceThresholdPct: z.number().int().min(0).max(100).default(75),
    attendanceTrackingFrom: isoDateSchema.nullable().default(null),
  })
  .refine(activeRangeCheck.check, activeRangeCheck.params);

/**
 * `PATCH /api/v1/groups/:id`: only the fields being changed. A range check that
 * needs the stored value too (a new `activeTo` against the old `activeFrom`) is the
 * database's job: its CHECK constraint refuses the update and the API answers 422.
 */
export const updateGroupSchema = z
  .object({
    name: text(80),
    colorToken: colorTokenSchema,
    activeFrom: isoDateSchema,
    activeTo: isoDateSchema.nullable(),
    observesHolidays: z.boolean(),
    attendance: z.boolean(),
    attendanceThresholdPct: z.number().int().min(0).max(100),
    attendanceTrackingFrom: isoDateSchema.nullable(),
  })
  .partial()
  .refine(activeRangeCheck.check, activeRangeCheck.params);

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const seriesDatesCheck = {
  check: (s: { startDate?: string; untilDate?: string | null }) =>
    s.startDate === undefined || s.untilDate == null || s.untilDate >= s.startDate,
  params: { path: ['untilDate'], message: 'must be on or after startDate' },
};

const seriesFields = {
  groupId: idSchema,
  /** The short name on the calendar block: "DS". */
  title: text(80),
  /** The full name attendance is counted by (B8): "Data Structures". */
  subject: text(120),
  location: optionalText(80),
  rule: ruleSchema,
  /** The first day it can happen, and the anchor for "every N weeks". */
  startDate: isoDateSchema,
  /** The last day it can happen, inclusive. `null` = until its group ends. */
  untilDate: isoDateSchema.nullable(),
  startTime: wallTimeSchema,
  /** Up to a whole day. */
  durationMin: z.number().int().min(1).max(1440),
  tzid: ianaZoneSchema,
};

/**
 * `POST /api/v1/series`. `subject` defaults to the title (B8), `location` and
 * `untilDate` to `null`. Without `tzid`, the server uses the user's profile zone.
 */
export const createSeriesSchema = z
  .object({
    id: newIdSchema,
    ...seriesFields,
    subject: seriesFields.subject.optional(),
    location: seriesFields.location.default(null),
    untilDate: seriesFields.untilDate.default(null),
    tzid: seriesFields.tzid.optional(),
  })
  .refine(seriesDatesCheck.check, seriesDatesCheck.params)
  .transform(({ subject, ...rest }) => ({ ...rest, subject: subject ?? rest.title }));

/**
 * `PATCH /api/v1/series/:id`: only the fields being changed, applied to every
 * occurrence, past ones included. That's fine while nothing hangs off past
 * occurrences; v0.3b adds "this and following" edits through `splitSeries` (D-023).
 */
export const updateSeriesSchema = z
  .object(seriesFields)
  .partial()
  .refine(seriesDatesCheck.check, seriesDatesCheck.params);

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

/** `GET /api/v1/calendar?from=2026-10-12&to=2026-10-18`: both days included. */
export const calendarQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .superRefine(({ from, to }, ctx) => {
    // zod runs this even when a date above already failed its own check (only
    // type errors stop it), and counting the days of `2026-02-30` would throw.
    // Those dates already have their error; there's nothing more to say.
    if (!isRealDate(from) || !isRealDate(to)) return;
    if (to < from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'must be on or after from' });
    } else if (daysInclusive(from, to) > MAX_CALENDAR_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `the window can span at most ${MAX_CALENDAR_DAYS} days`,
      });
    }
  });

// What callers send (before defaults and normalising), for the PWA's forms and tests.
export type CreateGroup = z.input<typeof createGroupSchema>;
export type UpdateGroup = z.input<typeof updateGroupSchema>;
export type CreateSeries = z.input<typeof createSeriesSchema>;
export type UpdateSeries = z.input<typeof updateSeriesSchema>;
export type CalendarQuery = z.input<typeof calendarQuerySchema>;
