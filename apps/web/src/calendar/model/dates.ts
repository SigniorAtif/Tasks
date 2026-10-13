// Calendar dates for the grid: which days a week holds, what "today" is in the
// user's zone, how far Previous and Next may go, and where to scroll on open.
//
// Dates are ISO strings (`2026-10-13`) everywhere outside this file, the same
// as the API sends. Temporal does the arithmetic, so "add 7 days" is right
// across month and year ends without any hand-written calendar maths.

import type { DateWindow, IanaZone, ISODate } from '@tasks/core';
import { Temporal } from 'temporal-polyfill';

/** Which grid the screen shows: one day (phones) or Monday to Sunday (wider screens). */
export type CalendarView = 'day' | 'week';

/** How many weeks before and after the current one Previous and Next can reach. */
export const NAV_WEEKS = 8;

/** Where the grid scrolls to when "now" isn't on screen: 07:00, in minutes since midnight. */
export const DEFAULT_SCROLL_MINUTE = 7 * 60;

/** `date` moved by `days` (negative goes back). */
export function addDays(date: ISODate, days: number): ISODate {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

/** The Monday of the week `date` is in. Weeks start on Monday (B11). */
export function mondayOf(date: ISODate): ISODate {
  const day = Temporal.PlainDate.from(date);
  // `dayOfWeek` is 1 for Monday up to 7 for Sunday.
  return day.subtract({ days: day.dayOfWeek - 1 }).toString();
}

/** The seven dates of the week starting on `monday`, Monday first. */
export function weekDays(monday: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The moment `nowEpochMs` as a wall clock and calendar in `zone`. */
function zoned(zone: IanaZone, nowEpochMs: number): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(nowEpochMs).toZonedDateTimeISO(zone);
}

/**
 * The calendar date it is in `zone` at that moment: what a wall calendar in
 * Bhubaneswar shows, whatever zone this phone is set to. This is the plain
 * date that changes at midnight, not the 04:00 "day boundary" (D-035), which
 * is about when a late night still counts as the day before.
 */
export function todayIn(zone: IanaZone, nowEpochMs: number): ISODate {
  return zoned(zone, nowEpochMs).toPlainDate().toString();
}

/** Minutes since midnight on the wall clock in `zone`: 14:05 is 845. Where the now line goes. */
export function minuteOfDayIn(zone: IanaZone, nowEpochMs: number): number {
  const now = zoned(zone, nowEpochMs);
  return now.hour * 60 + now.minute;
}

/**
 * The dates Previous and Next may reach: Monday 8 weeks before the current
 * week to Sunday 8 weeks after it. Whole weeks, so the Week view never shows
 * a half-allowed week.
 */
export function navRange(today: ISODate): DateWindow {
  const thisMonday = mondayOf(today);
  return {
    from: addDays(thisMonday, -7 * NAV_WEEKS),
    to: addDays(thisMonday, 7 * NAV_WEEKS + 6),
  };
}

/** Whether `date` is inside the inclusive `window`. ISO dates sort as text: `2026-10-09` < `2026-10-13`. */
export function isWithin(date: ISODate, window: DateWindow): boolean {
  return date >= window.from && date <= window.to;
}

/**
 * Where the anchor date goes after one press of Previous (`-1`) or Next (`+1`):
 * a day in Day view, a week in Week view. `null` when that leaves the range of
 * `navRange`, which is how the screen knows to disable the button. Checking
 * the new anchor alone is enough for weeks too: the range is made of whole
 * weeks, so a date is inside it exactly when its whole week is.
 */
export function stepAnchor(
  anchor: ISODate,
  view: CalendarView,
  direction: -1 | 1,
  today: ISODate,
): ISODate | null {
  const next = addDays(anchor, direction * (view === 'week' ? 7 : 1));
  return isWithin(next, navRange(today)) ? next : null;
}

/**
 * The minute of the day to scroll to when the grid opens: an hour before now,
 * so the class that just started is still on screen, but never earlier than
 * 07:00 (nobody needs to land on 3 AM). `nowMinute` is `null` when today isn't
 * among the visible days; then it's 07:00.
 */
export function initialScrollMinute(nowMinute: number | null): number {
  if (nowMinute === null) return DEFAULT_SCROLL_MINUTE;
  return Math.max(nowMinute - 60, DEFAULT_SCROLL_MINUTE);
}
