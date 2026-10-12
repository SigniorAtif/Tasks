import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { series } from '../test/builders.ts';
import type { Rule } from '../types.ts';
import {
  assertValidRule,
  expandDates,
  firstMatchOnOrAfter,
  occursOn,
  sameRule,
  untilDateForCount,
} from './dates.ts';

// Mon 5 Oct 2026 is "today" in these examples (docs/brainstorm/01 §7).
const MWF: Rule = { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] };

describe('expandDates', () => {
  it('E1: weekly Mon/Wed/Fri up to an inclusive until date', () => {
    const s = series({ rule: MWF, startDate: '2026-10-05', untilDate: '2026-10-16' });
    expect(expandDates(s, { from: '2026-10-01', to: '2026-12-01' })).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-09',
      '2026-10-12',
      '2026-10-14',
      '2026-10-16',
    ]);
  });

  it('E2: the order of byDay does not matter, and duplicates are ignored', () => {
    const a = series({ rule: MWF, untilDate: '2026-10-16' });
    const b = series({
      rule: { freq: 'weekly', interval: 1, byDay: ['FR', 'MO', 'WE', 'MO'] },
      untilDate: '2026-10-16',
    });
    const window = { from: '2026-10-01', to: '2026-12-01' };
    expect(expandDates(b, window)).toEqual(expandDates(a, window));
  });

  it("E3: every 2 weeks on Monday, starting on a Tuesday: the start's own week is on, but its Monday is before the start", () => {
    const s = series({
      rule: { freq: 'weekly', interval: 2, byDay: ['MO'] },
      startDate: '2026-10-06',
    });
    expect(expandDates(s, { from: '2026-10-01', to: '2026-11-30' })).toEqual([
      '2026-10-19',
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ]);
  });

  it('E4: every 3 days, counted from the series start rather than the window start', () => {
    const s = series({ rule: { freq: 'daily', interval: 3 }, startDate: '2026-10-05' });
    expect(expandDates(s, { from: '2026-10-09', to: '2026-10-20' })).toEqual([
      '2026-10-11',
      '2026-10-14',
      '2026-10-17',
      '2026-10-20',
    ]);
  });

  it('E5: an until date before the start date gives nothing', () => {
    const s = series({ startDate: '2026-10-05', untilDate: '2026-10-01' });
    expect(expandDates(s, { from: '2026-09-01', to: '2026-12-01' })).toEqual([]);
  });

  it('E6: a window entirely before the start gives nothing', () => {
    const s = series({ startDate: '2026-10-05' });
    expect(expandDates(s, { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
  });

  it("E7: the group's last active day is inclusive", () => {
    const s = series({ rule: { freq: 'weekly', interval: 1, byDay: ['FR'] } });
    const dates = expandDates(
      s,
      { from: '2026-11-01', to: '2026-12-31' },
      { activeFrom: '2026-07-13', activeTo: '2026-11-27' },
    );
    expect(dates.at(-1)).toBe('2026-11-27');
  });

  it("E8: a fortnightly rule keeps the series' phase when the group starts later", () => {
    const s = series({
      rule: { freq: 'weekly', interval: 2, byDay: ['MO'] },
      startDate: '2026-10-05',
    });
    const dates = expandDates(
      s,
      { from: '2026-10-01', to: '2026-11-01' },
      { activeFrom: '2026-10-12', activeTo: null },
    );
    // 10-12 is an "off" week for a series that started on 10-05.
    expect(dates).toEqual(['2026-10-19']);
  });

  it('E12: a daily series with no end over a 400-day window gives 400 dates', () => {
    const s = series({ rule: { freq: 'daily', interval: 1 }, startDate: '2026-01-01' });
    const to = Temporal.PlainDate.from('2026-01-01').add({ days: 399 }).toString();
    expect(expandDates(s, { from: '2026-01-01', to })).toHaveLength(400);
  });

  it('respects the group start for daily rules too', () => {
    const s = series({ rule: { freq: 'daily', interval: 2 }, startDate: '2026-10-01' });
    const dates = expandDates(
      s,
      { from: '2026-10-01', to: '2026-10-10' },
      { activeFrom: '2026-10-04', activeTo: null },
    );
    expect(dates).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
  });
});

describe('occursOn', () => {
  const s = series({ rule: MWF, startDate: '2026-10-05', untilDate: '2026-10-30' });

  it('is true on generated dates and false otherwise', () => {
    expect(occursOn(s, '2026-10-07')).toBe(true);
    expect(occursOn(s, '2026-10-08')).toBe(false);
    expect(occursOn(s, '2026-11-02')).toBe(false);
  });

  it('accepts a Temporal date and honours the group range', () => {
    const d = Temporal.PlainDate.from('2026-10-07');
    expect(occursOn(s, d, { activeFrom: '2026-10-08', activeTo: null })).toBe(false);
  });
});

describe('untilDateForCount', () => {
  it('daily: the count-th day', () => {
    expect(untilDateForCount({ freq: 'daily', interval: 3 }, '2026-10-05', 4)).toBe('2026-10-14');
  });

  it('weekly: counts only real occurrences, even when the start is off-pattern', () => {
    // Fortnightly Monday starting on a Tuesday: 10-19, 11-02, 11-16.
    const rule: Rule = { freq: 'weekly', interval: 2, byDay: ['MO'] };
    expect(untilDateForCount(rule, '2026-10-06', 3)).toBe('2026-11-16');
  });

  it('weekly with several days', () => {
    // Three a week: 05 07 09 · 12 14 16 · 19 21 23 · 26.
    expect(untilDateForCount(MWF, '2026-10-05', 10)).toBe('2026-10-26');
  });

  it('a count of 1 on an on-pattern start is the start itself', () => {
    expect(untilDateForCount(MWF, '2026-10-05', 1)).toBe('2026-10-05');
  });

  it.each([0, -1, 1.5])('rejects a count of %s', (count) => {
    expect(() => untilDateForCount(MWF, '2026-10-05', count)).toThrow(RangeError);
  });
});

describe('assertValidRule', () => {
  it.each<[string, unknown]>([
    ['interval 0 (would loop forever)', { freq: 'daily', interval: 0 }],
    ['a fractional interval', { freq: 'daily', interval: 1.5 }],
    ['a daily interval over 365', { freq: 'daily', interval: 366 }],
    ['a weekly interval over 52', { freq: 'weekly', interval: 53, byDay: ['MO'] }],
    ['a weekly rule with no days', { freq: 'weekly', interval: 1, byDay: [] }],
    ['an unknown weekday', { freq: 'weekly', interval: 1, byDay: ['XX'] }],
    [
      'an inherited property name as a weekday',
      { freq: 'weekly', interval: 1, byDay: ['toString'] },
    ],
    ['a monthly rule', { freq: 'monthly', interval: 1 }],
  ])('rejects %s', (_name, rule) => {
    expect(() => assertValidRule(rule as Rule)).toThrow(RangeError);
  });

  it('accepts the limits', () => {
    expect(() => assertValidRule({ freq: 'daily', interval: 365 })).not.toThrow();
    expect(() => assertValidRule({ freq: 'weekly', interval: 52, byDay: ['SU'] })).not.toThrow();
  });

  it('runs inside expansion, so bad data fails loudly instead of hanging', () => {
    const s = series({ rule: { freq: 'daily', interval: 0 } });
    expect(() => expandDates(s, { from: '2026-10-05', to: '2026-10-10' })).toThrow(RangeError);
  });
});

describe('sameRule', () => {
  it('compares weekdays as a set', () => {
    expect(sameRule(MWF, { freq: 'weekly', interval: 1, byDay: ['FR', 'WE', 'MO', 'WE'] })).toBe(
      true,
    );
    expect(sameRule(MWF, { freq: 'weekly', interval: 1, byDay: ['MO', 'WE'] })).toBe(false);
    expect(sameRule(MWF, { freq: 'weekly', interval: 2, byDay: ['MO', 'WE', 'FR'] })).toBe(false);
  });

  it('daily rules match on interval alone, and never match weekly ones', () => {
    expect(sameRule({ freq: 'daily', interval: 2 }, { freq: 'daily', interval: 2 })).toBe(true);
    expect(
      sameRule({ freq: 'daily', interval: 1 }, { freq: 'weekly', interval: 1, byDay: ['MO'] }),
    ).toBe(false);
  });
});

describe('firstMatchOnOrAfter', () => {
  const tue = Temporal.PlainDate.from('2026-10-06');

  it('daily: the date itself', () => {
    expect(firstMatchOnOrAfter({ freq: 'daily', interval: 4 }, tue).toString()).toBe('2026-10-06');
  });

  it('weekly: the nearest listed weekday, which may be the date itself', () => {
    expect(firstMatchOnOrAfter(MWF, tue).toString()).toBe('2026-10-07');
    expect(
      firstMatchOnOrAfter({ freq: 'weekly', interval: 1, byDay: ['MO'] }, tue).toString(),
    ).toBe('2026-10-12');
    expect(
      firstMatchOnOrAfter({ freq: 'weekly', interval: 1, byDay: ['TU'] }, tue).toString(),
    ).toBe('2026-10-06');
  });
});
