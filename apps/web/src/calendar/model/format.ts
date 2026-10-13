// The words and numbers the calendar shows: 12-hour times (B11), day and week
// labels, and the sentence a screen reader reads for a block.
//
// Times are formatted with `Intl.DateTimeFormat` in the display zone passed
// in, never the phone's own zone: a laptop left on UTC still shows a 10:00 AM
// class in Bhubaneswar as 10:00 AM. The app is English-only for now, so the
// locale is fixed, which also keeps the tests' expected strings stable.

import type { IanaZone, ISODate, Occurrence } from '@tasks/core';
import { Temporal } from 'temporal-polyfill';

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Temporal numbers weekdays 1 (Monday) to 7 and months 1 to 12; the lists start at 0.
const weekdayShort = (d: Temporal.PlainDate) => WEEKDAYS_SHORT[d.dayOfWeek - 1] ?? '';
const weekdayLong = (d: Temporal.PlainDate) => WEEKDAYS_LONG[d.dayOfWeek - 1] ?? '';
const monthShort = (d: Temporal.PlainDate) => MONTHS_SHORT[d.month - 1] ?? '';
const monthLong = (d: Temporal.PlainDate) => MONTHS_LONG[d.month - 1] ?? '';

/** The label beside an hour line on the time axis: `12 AM`, `9 AM`, `12 PM`, `5 PM`. */
export function hourLabel(hour: number): string {
  const onClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${onClock} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** A day column's header, in two parts so the number can be styled: `Mon` and `13`. */
export function dayHeader(date: ISODate): { weekday: string; day: number } {
  const d = Temporal.PlainDate.from(date);
  return { weekday: weekdayShort(d), day: d.day };
}

/** `Tue 13 Oct`: the Day view's title. */
export function dayLabel(date: ISODate): string {
  const d = Temporal.PlainDate.from(date);
  return `${weekdayShort(d)} ${d.day} ${monthShort(d)}`;
}

/** `Tuesday 13 October`: what a screen reader hears for a day. */
export function longDayLabel(date: ISODate): string {
  const d = Temporal.PlainDate.from(date);
  return `${weekdayLong(d)} ${d.day} ${monthLong(d)}`;
}

/**
 * The Week view's title, saying the month and year only once when they're shared:
 * `13–19 Oct 2026`, `28 Sep – 4 Oct 2026`, `28 Dec 2026 – 3 Jan 2027`.
 */
export function weekLabel(monday: ISODate): string {
  const first = Temporal.PlainDate.from(monday);
  const last = first.add({ days: 6 });
  if (first.year !== last.year) {
    return `${first.day} ${monthShort(first)} ${first.year} – ${last.day} ${monthShort(last)} ${last.year}`;
  }
  if (first.month !== last.month) {
    return `${first.day} ${monthShort(first)} – ${last.day} ${monthShort(last)} ${last.year}`;
  }
  return `${first.day}–${last.day} ${monthShort(last)} ${last.year}`;
}

// Building a formatter is slow compared with using one, so keep one per zone.
const clocks = new Map<IanaZone, Intl.DateTimeFormat>();
function clockFor(zone: IanaZone): Intl.DateTimeFormat {
  let clock = clocks.get(zone);
  if (clock === undefined) {
    clock = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    clocks.set(zone, clock);
  }
  return clock;
}

/** One moment on the 12-hour wall clock of `zone`, in pieces: `{ time: '10:30', period: 'AM' }`. */
function clockParts(epochMs: number, zone: IanaZone): { time: string; period: string } {
  let hour = '';
  let minute = '';
  let period = '';
  for (const part of clockFor(zone).formatToParts(epochMs)) {
    if (part.type === 'hour') hour = part.value;
    else if (part.type === 'minute') minute = part.value;
    else if (part.type === 'dayPeriod') period = part.value.toUpperCase();
  }
  return { time: `${hour}:${minute}`, period };
}

/**
 * A block's time range on the wall clock of `zone`, saying AM or PM once when
 * both ends share it: `10:00–11:00 AM`, `11:30 AM–12:30 PM`.
 */
export function timeRangeLabel(start: number, end: number, zone: IanaZone): string {
  const from = clockParts(start, zone);
  const to = clockParts(end, zone);
  return from.period === to.period
    ? `${from.time}–${to.time} ${to.period}`
    : `${from.time} ${from.period}–${to.time} ${to.period}`;
}

/** The short word a block shows for its state, or `null` for an ordinary one. */
export function statusLabel(occ: Occurrence): string | null {
  if (occ.status === 'cancelled') return occ.cancelReason === 'skipped' ? 'Skipped' : 'Cancelled';
  if (occ.moved) return 'Moved';
  if (occ.extra) return 'Extra';
  return null;
}

/**
 * Everything a block means, as one sentence for its `aria-label` and tooltip:
 * `Data Structures, 8:00–9:00 AM, C-301, Classes · Sem 3, cancelled: Holiday`.
 * It uses the subject (the full name), since the visible title may be a short code.
 */
export function blockDescription(occ: Occurrence, zone: IanaZone, groupName?: string): string {
  const parts = [
    occ.subject || occ.title,
    timeRangeLabel(Date.parse(occ.start), Date.parse(occ.end), zone),
  ];
  if (occ.location) parts.push(occ.location);
  if (groupName) parts.push(groupName);

  if (occ.status === 'cancelled') {
    const word = occ.cancelReason === 'skipped' ? 'skipped' : 'cancelled';
    parts.push(occ.holidayLabel ? `${word}: ${occ.holidayLabel}` : word);
  } else if (occ.moved) {
    parts.push('moved from its usual time');
  } else if (occ.extra) {
    parts.push('extra class');
  }
  if (occ.note) parts.push(`note: ${occ.note}`);
  return parts.join(', ');
}
