import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from './api.ts';
import { archiveDay, isArchived, localDateOf } from './days.ts';

/** A moment, written with its offset from UTC: `2026-11-28T04:00-05:00`. */
const at = (instant: string) => Temporal.Instant.from(instant).epochMilliseconds;
/** A moment, written as the wall clock in Kolkata shows it (UTC+05:30, no daylight saving). */
const inKolkata = (wall: string) => at(`${wall}+05:30`);

describe('archived: a last day that has passed, in the user’s day', () => {
  const sem3 = { untilDate: '2026-11-27' };

  it('a last day of 27 Nov reads archived from 04:00 on 28 Nov, not midnight', () => {
    const archivedAt = (wall: string) =>
      isArchived(sem3, localDateOf(inKolkata(wall), 'Asia/Kolkata', '04:00'));
    expect(archivedAt('2026-11-27T23:59')).toBe(false);
    expect(archivedAt('2026-11-28T00:00')).toBe(false);
    expect(archivedAt('2026-11-28T03:59')).toBe(false);
    expect(archivedAt('2026-11-28T04:00')).toBe(true);
  });

  it('starts the day at midnight for a profile on the defaults', () => {
    const { tzid, dayBoundary } = DEFAULT_PROFILE;
    const archivedAt = (wall: string) =>
      isArchived(sem3, localDateOf(inKolkata(wall), tzid, dayBoundary));
    expect(archivedAt('2026-11-27T23:59')).toBe(false);
    expect(archivedAt('2026-11-28T00:00')).toBe(true);
  });

  it('follows the zone and day boundary it is given, not the machine’s', () => {
    // 05:30 in Kolkata on the 28th is still 19:00 on the 27th in New York.
    expect(localDateOf(inKolkata('2026-11-28T05:30'), 'America/New_York', '00:00')).toBe(
      '2026-11-27',
    );
    expect(localDateOf(at('2026-11-28T00:00-05:00'), 'America/New_York', '00:00')).toBe(
      '2026-11-28',
    );
  });

  it('rolls over at the boundary on the wall clock, on a daylight-saving day too', () => {
    // 8 Mar 2026: New York's clocks jump from 02:00 to 03:00. Four hours after midnight
    // is 05:00 on the wall that night, but the day still starts at 04:00 on the wall.
    expect(localDateOf(at('2026-03-08T03:59-04:00'), 'America/New_York', '04:00')).toBe(
      '2026-03-07',
    );
    expect(localDateOf(at('2026-03-08T04:00-04:00'), 'America/New_York', '04:00')).toBe(
      '2026-03-08',
    );
  });

  it('never archives a group or series with no last day', () => {
    expect(isArchived({ untilDate: null }, '2099-01-01')).toBe(false);
  });
});

describe('Archive: the last day it sets', () => {
  const today = '2026-11-10';

  it('is today for a group or series with no last day, or a later one', () => {
    expect(archiveDay({ untilDate: null }, today)).toBe(today);
    expect(archiveDay({ untilDate: '2026-11-27' }, today)).toBe(today);
  });

  it('is nothing to set when the last day is already today or earlier: never later', () => {
    expect(archiveDay({ untilDate: today }, today)).toBeUndefined();
    expect(archiveDay({ untilDate: '2026-10-30' }, today)).toBeUndefined();
  });

  it("is nothing when the group's last day is already today or earlier: the class has ended", () => {
    const ended = { untilDate: '2026-10-30' };
    expect(archiveDay({ untilDate: null }, today, ended)).toBeUndefined();
    expect(archiveDay({ untilDate: null }, today, { untilDate: '2026-12-18' })).toBe(today);
  });

  it('is nothing for a series that starts after today: it can only be deleted', () => {
    expect(archiveDay({ startDate: '2026-11-11', untilDate: null }, today)).toBeUndefined();
    expect(archiveDay({ startDate: today, untilDate: null }, today)).toBe(today);
  });
});
