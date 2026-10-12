// Showing the server's clock in the user's zone. Two separate jobs:
//
// 1. Which moment is it on the server right now? `/api/v1/me` tells us the
//    server's time once per fetch; between fetches we add the time that has
//    passed on this device's clock. (Not the device's clock itself: a phone
//    set five minutes fast would show the wrong time.)
// 2. What does that moment look like on a wall clock in `Asia/Kolkata`?
//    `Intl.DateTimeFormat` with `timeZone` does that conversion, including
//    daylight-saving rules, using the time-zone data built into the browser.
//
// Everything works on epoch milliseconds (ms since 1970-01-01T00:00Z), the one
// number every clock agrees on.

import type { IanaZone, Instant } from '@tasks/core';

/**
 * The server's clock now, estimated from a reading taken earlier.
 * `receivedAt` and `now` are this device's `Date.now()` at the reading and now.
 * `null` when `serverTime` isn't a valid timestamp.
 */
export function serverNow(serverTime: Instant, receivedAt: number, now: number): number | null {
  const reading = Date.parse(serverTime);
  if (Number.isNaN(reading)) return null;
  return reading + (now - receivedAt);
}

/** Whether this browser knows the zone. An unknown one makes Intl throw a RangeError. */
export function isKnownZone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedTime {
  /** Wall-clock time with seconds, in the locale's style: `14:02:05` or `2:02:05 pm`. */
  time: string;
  /** `Monday 12 October 2026`, in the locale's style. */
  date: string;
  /** The zone's offset from UTC at that moment: `GMT+5:30`. Changes across daylight saving. */
  offset: string;
  /** The zone actually used: `tzid`, or `UTC` when this browser doesn't know `tzid`. */
  zone: IanaZone;
}

/**
 * Formats a moment as it reads on a wall clock in `tzid`. `locale` defaults to
 * the browser's language (so 12- or 24-hour follows the user's settings);
 * tests pass one so their output is predictable.
 */
export function formatInZone(epochMs: number, tzid: IanaZone, locale?: string): ZonedTime {
  const zone = isKnownZone(tzid) ? tzid : 'UTC';
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(epochMs);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(epochMs);
  // `shortOffset` gives `GMT+5:30`, which means the same in every language,
  // unlike abbreviations such as `IST` (India, Israel or Ireland?).
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(epochMs)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  return { time, date, offset, zone };
}
