// Which day it is for the user, and whether a group or series has ended.
//
// The user's day starts at their day boundary (`dayBoundary` in the profile,
// D-035). That's midnight unless it's set later: with 04:00, a class at 01:00
// after a late night still belongs to the evening before. "Today" here is that
// day, in the user's zone (`tzid`), whatever the phone or server is set to.

import { Temporal } from 'temporal-polyfill';
import type { IanaZone, ISODate, WallTime } from './types.ts';

/**
 * The user's day at a moment (D-035): the date in `tzid`, or the day before it
 * while the wall clock there is still before `dayBoundary`. Compared on the
 * wall clock, so a daylight-saving jump moves the boundary with it.
 */
export function localDateOf(epochMs: number, tzid: IanaZone, dayBoundary: WallTime): ISODate {
  const wall = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(tzid);
  const date = wall.toPlainDate();
  const beforeBoundary =
    Temporal.PlainTime.compare(wall.toPlainTime(), Temporal.PlainTime.from(dayBoundary)) < 0;
  return (beforeBoundary ? date.subtract({ days: 1 }) : date).toString();
}

/**
 * A group or series is archived once its last day is before `today`, the
 * user's day (`localDateOf`). Never stored: it follows from the last day, so
 * "Sem 3 ends 27 Nov" archives itself on the 28th with no second step. No
 * last day, never archived.
 */
export function isArchived(item: { untilDate: ISODate | null }, today: ISODate): boolean {
  return item.untilDate !== null && item.untilDate < today;
}

/**
 * The last day Archive sets: the earlier of the current last day and the day
 * before `today`, so the day you archive doesn't count and ending something
 * never extends it. `undefined` when there's nothing to archive: it already
 * ends yesterday or earlier, by its own last day or, for a series, its group's;
 * or a series starts today or later (the database refuses a last day before
 * the first, so it can only be deleted). Groups have no first day.
 */
export function archiveDay(
  item: { untilDate: ISODate | null; startDate?: ISODate },
  today: ISODate,
  group?: { untilDate: ISODate | null },
): ISODate | undefined {
  const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString();
  if (item.startDate !== undefined && item.startDate > yesterday) return undefined;
  const endsBy = (lastDay: ISODate | null | undefined) => lastDay != null && lastDay <= yesterday;
  if (endsBy(item.untilDate) || endsBy(group?.untilDate)) return undefined;
  return yesterday;
}
