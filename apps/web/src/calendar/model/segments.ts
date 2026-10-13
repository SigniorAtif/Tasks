// Step 1 of drawing: cut each occurrence into the pieces that sit in one day
// column. The API sends `start` and `end` as instants (moments in UTC); the
// grid needs "which day, from which minute to which minute" on the wall clock
// of the display zone.
//
// Most occurrences give exactly one piece. One that crosses midnight (a night
// shift 23:00 to 01:00) gives two: the end of one day and the start of the next.

import type { IanaZone, ISODate, Occurrence } from '@tasks/core';
import { Temporal } from 'temporal-polyfill';

/** Minutes in a day column. The grid is drawn 24 hours tall even on a 23- or 25-hour day. */
export const MINUTES_PER_DAY = 1440;

/** The part of one occurrence that falls on one visible day. */
export interface Segment {
  occ: Occurrence;
  day: ISODate;
  /** Wall-clock minutes since midnight where the piece starts, 0 to 1439. */
  startMin: number;
  /** Where it ends, exclusive: always more than `startMin`, at most 1440. */
  endMin: number;
  /** It started on an earlier day (so it's cut at the top). */
  continuesBefore: boolean;
  /** It goes on into a later day (so it's cut at the bottom). */
  continuesAfter: boolean;
}

type ZonedDateTime = Temporal.ZonedDateTime;
const { compare } = Temporal.ZonedDateTime;
const later = (a: ZonedDateTime, b: ZonedDateTime) => (compare(a, b) >= 0 ? a : b);
const earlier = (a: ZonedDateTime, b: ZonedDateTime) => (compare(a, b) <= 0 ? a : b);

/** The minute of the day the wall clock shows: 10:30 is 630. */
const wallMinute = (t: ZonedDateTime) => t.hour * 60 + t.minute;

/**
 * When `day` begins in `zone`. Usually 00:00; in a zone whose daylight-saving
 * jump skips midnight, it's 01:00. Asking Temporal (this is what
 * `ZonedDateTime.startOfDay()` computes) instead of adding 24 hours to the day
 * before matters: a day with a daylight-saving change is 23 or 25 hours long.
 */
const startOfDay = (day: Temporal.PlainDate, zone: IanaZone) =>
  day.toZonedDateTime({ timeZone: zone });

/**
 * The segments of `occurrences` that fall on `days` (in ascending order;
 * the grid passes consecutive ones), placed on the wall clock of `zone`.
 * Pieces on other days are dropped. Sorted by `compareSegments`.
 */
export function toSegments(
  occurrences: readonly Occurrence[],
  days: readonly ISODate[],
  zone: IanaZone,
): Segment[] {
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) return [];
  const firstDay = Temporal.PlainDate.from(first);
  const lastDay = Temporal.PlainDate.from(last);
  const visible = new Set(days);

  const out: Segment[] = [];
  for (const occ of occurrences) {
    const start = Temporal.Instant.from(occ.start).toZonedDateTimeISO(zone);
    const end = Temporal.Instant.from(occ.end).toZonedDateTimeISO(zone);
    // Zero or negative length: nothing to draw. Valid data never has this.
    if (compare(end, start) <= 0) continue;

    // Walk day by day from the later of "the day it starts" and "the first
    // visible day", so an occurrence that began before the window costs
    // nothing extra.
    const startDay = start.toPlainDate();
    let day = Temporal.PlainDate.compare(startDay, firstDay) >= 0 ? startDay : firstDay;
    for (; Temporal.PlainDate.compare(day, lastDay) <= 0; day = day.add({ days: 1 })) {
      const dayStart = startOfDay(day, zone);
      if (compare(dayStart, end) >= 0) break; // it ended before this day began
      const nextDayStart = startOfDay(day.add({ days: 1 }), zone);
      if (!visible.has(day.toString())) continue;

      const pieceStart = later(start, dayStart);
      const pieceEnd = earlier(end, nextDayStart);
      const continuesBefore = compare(start, dayStart) < 0;
      const continuesAfter = compare(end, nextDayStart) > 0;

      const startMin = continuesBefore ? 0 : wallMinute(pieceStart);
      let endMin = compare(pieceEnd, nextDayStart) === 0 ? MINUTES_PER_DAY : wallMinute(pieceEnd);
      if (endMin <= startMin) {
        // Only possible when the clocks go back: 01:30 to 01:15 an hour later
        // reads backwards on the wall. The repeated hour is drawn once (a
        // known limit, 09 §7 T7), so use the real length instead.
        const lengthMin = (pieceEnd.epochMilliseconds - pieceStart.epochMilliseconds) / 60_000;
        endMin = Math.min(MINUTES_PER_DAY, startMin + Math.max(1, Math.round(lengthMin)));
      }

      out.push({ occ, day: day.toString(), startMin, endMin, continuesBefore, continuesAfter });
    }
  }

  return out.sort(compareSegments);
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order segments are drawn and laid out in: by day, then earliest start,
 * then the longer one first, then by key. The key makes it total, so two
 * occurrences at the same time always come out in the same order however the
 * API listed them.
 */
export function compareSegments(a: Segment, b: Segment): number {
  return (
    byText(a.day, b.day) ||
    a.startMin - b.startMin ||
    b.endMin - a.endMin ||
    byText(a.occ.key, b.occ.key)
  );
}
