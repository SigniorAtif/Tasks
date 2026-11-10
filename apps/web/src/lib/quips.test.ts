import type { ISODate, Profile } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import { occurrence } from '../calendar/model/test-builders.ts';
import {
  cancelQuip,
  everyClassCancelled,
  loadingQuip,
  quip,
  RARE_LOADING_CHANCE,
} from './quips.ts';
import { todayFor } from './time.ts';

const DAY: ISODate = '2026-10-06';

/** The eight days from `DAY` on. */
const EIGHT_DAYS: ISODate[] = [6, 7, 8, 9, 10, 11, 12, 13].map(
  (d) => `2026-10-${String(d).padStart(2, '0')}`,
);

describe('quip', () => {
  it('says the same line all day', () => {
    expect(quip('loading', DAY)).toBe(quip('loading', DAY));
    expect(quip('loading', DAY)).not.toBe('');
  });

  it('moves to another line the next day, and repeats none for eight days', () => {
    const lines = EIGHT_DAYS.map((day) => quip('emptyDay', day));
    expect(new Set(lines).size).toBe(8);
  });

  it('keeps rotating across a month end', () => {
    expect(quip('emptyDay', '2026-10-31')).not.toBe(quip('emptyDay', '2026-11-01'));
  });

  it("gives each moment its own lines, so the toast doesn't repeat the badge", () => {
    expect(quip('badge', DAY)).not.toBe(quip('confirmDelete', DAY));
    expect(quip('prof', DAY)).not.toBe(quip('me', DAY));
  });

  it("changes at the profile's day boundary, not at midnight", () => {
    const profile: Profile = { tzid: 'Asia/Kolkata', dayBoundary: '04:00' };
    // 7 October in Kolkata: 03:59 still belongs to the 6th, 04:00 starts the 7th.
    const lateNight = Date.parse('2026-10-07T03:59:00+05:30');
    const morning = Date.parse('2026-10-07T04:00:00+05:30');
    expect(quip('loading', todayFor(profile, lateNight))).toBe(quip('loading', '2026-10-06'));
    expect(quip('loading', todayFor(profile, morning))).toBe(quip('loading', '2026-10-07'));
    expect(quip('loading', '2026-10-06')).not.toBe(quip('loading', '2026-10-07'));
  });
});

describe('loadingQuip', () => {
  it("says the day's loading line on an ordinary roll", () => {
    expect(loadingQuip(DAY, RARE_LOADING_CHANCE)).toBe(quip('loading', DAY));
    expect(loadingQuip(DAY, 0.99)).toBe(quip('loading', DAY));
  });

  it('says a line kept for the rare roll, one no ordinary day gets', () => {
    const rare = loadingQuip(DAY, 0);
    expect(EIGHT_DAYS.map((day) => quip('loading', day))).not.toContain(rare);
    expect(loadingQuip(DAY, RARE_LOADING_CHANCE - 0.001)).toBe(rare);
  });

  it('keeps the rare roll rare', () => {
    expect(RARE_LOADING_CHANCE).toBeLessThanOrEqual(0.05);
  });
});

/** A class on `DAY` at `hour`, each with its own key. */
const classAt = (hour: number, fields: Parameters<typeof occurrence>[0] = {}) =>
  occurrence({ key: `s${hour}:${DAY}`, seriesId: `s${hour}`, date: DAY, ...fields });
const skippedAt = (hour: number) => classAt(hour, { status: 'cancelled', cancelReason: 'skipped' });
const profCancelledAt = (hour: number) =>
  classAt(hour, { status: 'cancelled', cancelReason: 'not_held' });

describe('everyClassCancelled', () => {
  it('is true when each class of the day is cancelled, whatever the reason', () => {
    const day = [skippedAt(8), profCancelledAt(9), classAt(10, { status: 'cancelled' })];
    expect(everyClassCancelled(day, DAY)).toBe(true);
  });

  it('is false while one class is still on', () => {
    expect(everyClassCancelled([skippedAt(8), classAt(9)], DAY)).toBe(false);
  });

  it('never fires on a day with no classes', () => {
    expect(everyClassCancelled([], DAY)).toBe(false);
    // Tomorrow's cancelled class says nothing about today.
    const tomorrow = occurrence({ date: '2026-10-07', status: 'cancelled' });
    expect(everyClassCancelled([tomorrow], DAY)).toBe(false);
  });

  it("looks only at the day's own classes", () => {
    const tomorrow = occurrence({ key: 't:2026-10-07', date: '2026-10-07' });
    expect(everyClassCancelled([profCancelledAt(8), tomorrow], DAY)).toBe(true);
  });
});

describe('cancelQuip', () => {
  it("says the day's line for the reason", () => {
    expect(cancelQuip(skippedAt(8), [classAt(8), classAt(9)], DAY)).toBe(quip('skipped', DAY));
    expect(cancelQuip(profCancelledAt(8), [classAt(8)], DAY)).toBe(quip('cancelledByProf', DAY));
    const notToday = classAt(8, { status: 'cancelled' });
    expect(cancelQuip(notToday, [classAt(8)], DAY)).toBe(quip('notToday', DAY));
  });

  it('roasts, gently, at the third skip of one day', () => {
    const before = [skippedAt(8), skippedAt(9), classAt(10)];
    const roast = cancelQuip(skippedAt(10), before, DAY);
    expect(EIGHT_DAYS.map((day) => quip('skipped', day))).not.toContain(roast);
    expect(roast).toMatch(/three/i);
  });

  it('does not roast at the second skip', () => {
    expect(cancelQuip(skippedAt(9), [skippedAt(8), classAt(9)], DAY)).toBe(quip('skipped', DAY));
  });

  it("does not count the prof's cancels, or skips on another day", () => {
    const yesterday = occurrence({
      key: 'y:2026-10-05',
      date: '2026-10-05',
      status: 'cancelled',
      cancelReason: 'skipped',
    });
    const before = [profCancelledAt(8), skippedAt(9), yesterday, classAt(10)];
    expect(cancelQuip(skippedAt(10), before, DAY)).toBe(quip('skipped', DAY));
  });

  it('does not roast a cancel by the prof on a day of three skips', () => {
    const before = [skippedAt(8), skippedAt(9), skippedAt(10), classAt(11)];
    expect(cancelQuip(profCancelledAt(11), before, DAY)).toBe(quip('cancelledByProf', DAY));
  });

  it('counts the class once when its reason changes to skipped', () => {
    const before = [skippedAt(8), skippedAt(9)];
    expect(cancelQuip(skippedAt(9), before, DAY)).toBe(quip('skipped', DAY));
  });
});
