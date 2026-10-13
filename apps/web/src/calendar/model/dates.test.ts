// Every function here takes the zone as an argument, so these pass whatever
// zone the machine is in. `pnpm test:tz` runs them under three to make sure.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  initialScrollMinute,
  isWithin,
  minuteOfDayIn,
  mondayOf,
  navRange,
  stepAnchor,
  todayIn,
  weekDays,
} from './dates.ts';

const at = (iso: string) => Date.parse(iso);

describe('mondayOf', () => {
  it('finds the Monday of the week, Monday itself included', () => {
    expect(mondayOf('2026-10-13')).toBe('2026-10-12'); // Tuesday
    expect(mondayOf('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sunday belongs to the week before it
  });

  it('crosses month and year ends', () => {
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });
});

describe('weekDays', () => {
  it('lists Monday to Sunday', () => {
    expect(weekDays('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
});

describe('addDays', () => {
  it('goes both ways across a month end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('todayIn', () => {
  it("is the zone's date, not UTC's", () => {
    // 20:00 UTC on the 12th is already 01:30 on the 13th in India...
    expect(todayIn('Asia/Kolkata', at('2026-10-12T20:00:00Z'))).toBe('2026-10-13');
    // ...and still 16:00 on the 12th in New York.
    expect(todayIn('America/New_York', at('2026-10-12T20:00:00Z'))).toBe('2026-10-12');
  });

  it('changes at midnight, not at the 04:00 day boundary', () => {
    expect(todayIn('Asia/Kolkata', at('2026-10-12T18:29:59Z'))).toBe('2026-10-12'); // 23:59:59
    expect(todayIn('Asia/Kolkata', at('2026-10-12T18:30:00Z'))).toBe('2026-10-13'); // 00:00
  });
});

describe('minuteOfDayIn', () => {
  it('reads the wall clock in the zone', () => {
    expect(minuteOfDayIn('Asia/Kolkata', at('2026-10-13T08:35:40Z'))).toBe(14 * 60 + 5);
  });

  it('follows daylight saving: New York after the jump reads 03:00', () => {
    expect(minuteOfDayIn('America/New_York', at('2026-03-08T07:00:00Z'))).toBe(3 * 60);
  });
});

describe('navRange and stepAnchor', () => {
  const today = '2026-10-14'; // a Wednesday; this week's Monday is 2026-10-12

  it('spans 8 whole weeks either side of this week', () => {
    expect(navRange(today)).toEqual({ from: '2026-08-17', to: '2026-12-13' });
  });

  it('moves a week at a time in Week view and a day at a time in Day view', () => {
    expect(stepAnchor(today, 'week', 1, today)).toBe('2026-10-21');
    expect(stepAnchor(today, 'week', -1, today)).toBe('2026-10-07');
    expect(stepAnchor(today, 'day', 1, today)).toBe('2026-10-15');
    expect(stepAnchor(today, 'day', -1, today)).toBe('2026-10-13');
  });

  it('stops at the earliest and latest allowed weeks', () => {
    // Week view: from the 8th week back there's nowhere further back to go.
    expect(stepAnchor('2026-08-19', 'week', -1, today)).toBeNull();
    expect(stepAnchor('2026-08-26', 'week', -1, today)).toBe('2026-08-19');
    expect(stepAnchor('2026-12-09', 'week', 1, today)).toBeNull();
    // Day view: the first Monday and the last Sunday are the ends.
    expect(stepAnchor('2026-08-17', 'day', -1, today)).toBeNull();
    expect(stepAnchor('2026-08-18', 'day', -1, today)).toBe('2026-08-17');
    expect(stepAnchor('2026-12-13', 'day', 1, today)).toBeNull();
    expect(stepAnchor('2026-12-12', 'day', 1, today)).toBe('2026-12-13');
  });

  it('allows exactly 8 Next presses and 8 Previous presses in Week view', () => {
    const presses = (direction: -1 | 1) => {
      let anchor = today;
      let count = 0;
      for (let next = stepAnchor(anchor, 'week', direction, today); next !== null; ) {
        anchor = next;
        count++;
        next = stepAnchor(anchor, 'week', direction, today);
      }
      return count;
    };
    expect(presses(1)).toBe(8);
    expect(presses(-1)).toBe(8);
  });

  it('checks inclusion with both ends counted', () => {
    const window = { from: '2026-10-12', to: '2026-10-18' };
    expect(isWithin('2026-10-12', window)).toBe(true);
    expect(isWithin('2026-10-18', window)).toBe(true);
    expect(isWithin('2026-10-19', window)).toBe(false);
  });
});

describe('initialScrollMinute', () => {
  it('is an hour before now', () => {
    expect(initialScrollMinute(14 * 60 + 5)).toBe(13 * 60 + 5);
  });

  it('never goes earlier than 07:00', () => {
    expect(initialScrollMinute(7 * 60 + 30)).toBe(7 * 60);
    expect(initialScrollMinute(2 * 60)).toBe(7 * 60);
  });

  it('is 07:00 when today is not on screen', () => {
    expect(initialScrollMinute(null)).toBe(7 * 60);
  });
});
