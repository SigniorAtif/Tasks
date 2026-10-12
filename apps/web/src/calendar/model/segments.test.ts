// The zone is always passed in, so these pass under any machine zone
// (`pnpm test:tz`). New York is here because India has no daylight saving:
// tests only in Asia/Kolkata would never meet a 23- or 25-hour day.
import { describe, expect, it } from 'vitest';
import { toSegments } from './segments.ts';
import { occurrence } from './test-builders.ts';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

/**
 * Each segment as one line: `'2026-10-05 1380-1440 >'`. A leading `<` means
 * it continues from the day before, a trailing `>` that it goes on into the next.
 */
const shape = (segments: ReturnType<typeof toSegments>) =>
  segments.map(
    (s) =>
      `${s.continuesBefore ? '< ' : ''}${s.day} ${s.startMin}-${s.endMin}${s.continuesAfter ? ' >' : ''}`,
  );

describe('toSegments', () => {
  it('places an instant on the wall clock of the display zone (09 §7 T1)', () => {
    // 04:30 UTC is 10:00 in India.
    const occ = occurrence({ start: '2026-10-06T04:30:00Z', end: '2026-10-06T05:30:00Z' });
    expect(shape(toSegments([occ], ['2026-10-06'], IST))).toEqual(['2026-10-06 600-660']);
  });

  it('uses the display zone, not the zone the series was written in', () => {
    // The same 10:00 India class seen with New York as the display zone is 00:30 that day.
    const occ = occurrence({ start: '2026-10-06T04:30:00Z', end: '2026-10-06T05:30:00Z' });
    expect(shape(toSegments([occ], ['2026-10-06'], NY))).toEqual(['2026-10-06 30-90']);
  });

  it('cuts an occurrence that crosses midnight into two (09 §7 T2)', () => {
    // Monday 23:00 to Tuesday 01:00 in India.
    const occ = occurrence({ start: '2026-10-05T17:30:00Z', end: '2026-10-05T19:30:00Z' });
    expect(shape(toSegments([occ], ['2026-10-05', '2026-10-06'], IST))).toEqual([
      '2026-10-05 1380-1440 >',
      '< 2026-10-06 0-60',
    ]);
  });

  it('keeps only the visible half', () => {
    const occ = occurrence({ start: '2026-10-05T17:30:00Z', end: '2026-10-05T19:30:00Z' });
    expect(shape(toSegments([occ], ['2026-10-06'], IST))).toEqual(['< 2026-10-06 0-60']);
    expect(shape(toSegments([occ], ['2026-10-05'], IST))).toEqual(['2026-10-05 1380-1440 >']);
  });

  it('ends at 1440 when it ends exactly at midnight, with nothing on the next day', () => {
    // 23:00 to 00:00 in India.
    const occ = occurrence({ start: '2026-10-05T17:30:00Z', end: '2026-10-05T18:30:00Z' });
    expect(shape(toSegments([occ], ['2026-10-05', '2026-10-06'], IST))).toEqual([
      '2026-10-05 1380-1440',
    ]);
  });

  it('drops occurrences on days that are not shown, and draws nothing for no days', () => {
    const occ = occurrence();
    expect(toSegments([occ], ['2026-10-07'], IST)).toEqual([]);
    expect(toSegments([occ], [], IST)).toEqual([]);
  });

  it('skips an occurrence with no length', () => {
    const occ = occurrence({ start: '2026-10-06T04:30:00Z', end: '2026-10-06T04:30:00Z' });
    expect(toSegments([occ], ['2026-10-06'], IST)).toEqual([]);
  });

  it('sorts by day, then start, longer first, whatever order the input had', () => {
    const late = occurrence({
      key: 'b:2026-10-06',
      start: '2026-10-06T05:30:00Z',
      end: '2026-10-06T06:30:00Z',
    });
    const short = occurrence({
      key: 'c:2026-10-06',
      start: '2026-10-06T04:30:00Z',
      end: '2026-10-06T05:00:00Z',
    });
    const long = occurrence({
      key: 'a:2026-10-06',
      start: '2026-10-06T04:30:00Z',
      end: '2026-10-06T06:00:00Z',
    });
    const keys = toSegments([late, short, long], ['2026-10-06'], IST).map((s) => s.occ.key);
    expect(keys).toEqual(['a:2026-10-06', 'c:2026-10-06', 'b:2026-10-06']);
  });

  describe('daylight saving in New York', () => {
    it('walks a 23-hour day by its real boundaries (2026-03-08, clocks jump 02:00 → 03:00)', () => {
      // Saturday 22:00 EST to Monday 02:00 EDT.
      const occ = occurrence({ start: '2026-03-08T03:00:00Z', end: '2026-03-09T06:00:00Z' });
      expect(shape(toSegments([occ], ['2026-03-07', '2026-03-08', '2026-03-09'], NY))).toEqual([
        '2026-03-07 1320-1440 >',
        // Adding 24 hours to Sunday's midnight would land on Monday 01:00 and get this wrong.
        '< 2026-03-08 0-1440 >',
        '< 2026-03-09 0-120',
      ]);
    });

    it('draws a block across the skipped hour by the wall clock', () => {
      // 01:30 EST to 03:30 EDT is one real hour, but two hours on the wall and the grid.
      const occ = occurrence({ start: '2026-03-08T06:30:00Z', end: '2026-03-08T07:30:00Z' });
      expect(shape(toSegments([occ], ['2026-03-08'], NY))).toEqual(['2026-03-08 90-210']);
    });

    it('walks a 25-hour day by its real boundaries (2026-11-01, clocks go back 02:00 → 01:00)', () => {
      // Saturday 23:00 EDT to Monday 01:00 EST.
      const occ = occurrence({ start: '2026-11-01T03:00:00Z', end: '2026-11-02T06:00:00Z' });
      expect(shape(toSegments([occ], ['2026-10-31', '2026-11-01', '2026-11-02'], NY))).toEqual([
        '2026-10-31 1380-1440 >',
        '< 2026-11-01 0-1440 >',
        '< 2026-11-02 0-60',
      ]);
    });

    it('draws the repeated hour once, using the real length (09 §7 T7)', () => {
      // 01:30 EDT to 01:30 EST: an hour passes, but the wall clock reads 01:30 both times.
      const occ = occurrence({ start: '2026-11-01T05:30:00Z', end: '2026-11-01T06:30:00Z' });
      expect(shape(toSegments([occ], ['2026-11-01'], NY))).toEqual(['2026-11-01 90-150']);
    });

    it('keeps a 09:00 class at 09:00 on both sides of the change (09 §7 T5)', () => {
      const before = occurrence({ start: '2026-10-30T13:00:00Z', end: '2026-10-30T14:00:00Z' });
      const after = occurrence({ start: '2026-11-06T14:00:00Z', end: '2026-11-06T15:00:00Z' });
      const days = ['2026-10-30', '2026-11-06'];
      expect(toSegments([before, after], days, NY).map((s) => s.startMin)).toEqual([540, 540]);
    });
  });
});
