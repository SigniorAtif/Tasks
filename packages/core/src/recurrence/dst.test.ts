// India has no daylight saving, so these bugs would never show up in daily use here.
// The tests use zones that do have it. Transition dates verified with Temporal:
// New York springs forward 8 Mar 2026 (02:00 → 03:00) and falls back 1 Nov 2026;
// London falls back 25 Oct 2026; Lord Howe Island springs forward 30 minutes on 4 Oct 2026.

import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { group, series } from '../test/builders.ts';
import type { Series } from '../types.ts';
import { expand } from './expand.ts';

const daily = { freq: 'daily', interval: 1 } as const;

// The group starts early so the historical dates below aren't clipped away.
const always = group({ activeFrom: '2000-01-01' });

function occurrences(s: Series, from: string, to: string) {
  return expand({
    groups: [always],
    series: [s],
    overrides: [],
    dayExceptions: [],
    window: { from, to },
  });
}

/** An instant as a local time with its offset, e.g. `2026-03-08T03:30:00-04:00`. */
const local = (instant: string, tzid: string) =>
  Temporal.Instant.from(instant).toZonedDateTimeISO(tzid).toString({ timeZoneName: 'never' });

describe('daylight saving', () => {
  it("T1: a time inside the spring-forward gap moves forward by the gap's length and is flagged", () => {
    const s = series({
      rule: daily,
      startDate: '2026-03-01',
      startTime: '02:30',
      tzid: 'America/New_York',
    });
    const occs = occurrences(s, '2026-03-07', '2026-03-09');
    expect(occs.map((o) => [o.key, local(o.start, o.tzid), o.dstShifted])).toEqual([
      ['s:2026-03-07', '2026-03-07T02:30:00-05:00', false],
      ['s:2026-03-08', '2026-03-08T03:30:00-04:00', true],
      ['s:2026-03-09', '2026-03-09T02:30:00-04:00', false],
    ]);
  });

  it('T2: a time that happens twice resolves to the first one; the end is real elapsed time', () => {
    const s = series({
      rule: daily,
      startDate: '2026-11-01',
      startTime: '01:30',
      tzid: 'America/New_York',
    });
    const [occ] = occurrences(s, '2026-11-01', '2026-11-01');
    expect(occ && local(occ.start, occ.tzid)).toBe('2026-11-01T01:30:00-04:00');
    // 60 minutes later the clocks have gone back, so it "ends" at 01:30 again, an hour later.
    expect(occ && local(occ.end, occ.tzid)).toBe('2026-11-01T01:30:00-05:00');
    expect(occ?.dstShifted).toBe(false);
  });

  it('T3: a 30-minute gap (Lord Howe Island) moves the time by 30 minutes', () => {
    const s = series({
      rule: daily,
      startDate: '2026-10-01',
      startTime: '02:15',
      tzid: 'Australia/Lord_Howe',
    });
    const [occ] = occurrences(s, '2026-10-04', '2026-10-04');
    expect(occ && local(occ.start, occ.tzid)).toBe('2026-10-04T02:45:00+11:00');
    expect(occ?.dstShifted).toBe(true);
  });

  it('T4: a London class keeps its London time, so seen from India it shifts when London changes', () => {
    const s = series({
      rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'FR'] },
      startDate: '2026-10-01',
      tzid: 'Europe/London',
    });
    const occs = occurrences(s, '2026-10-23', '2026-10-26');
    expect(occs.map((o) => local(o.start, 'Asia/Kolkata'))).toEqual([
      '2026-10-23T14:30:00+05:30',
      '2026-10-26T15:30:00+05:30',
    ]);
  });

  it('T5: a Kolkata class seen from London moves by an hour when London changes', () => {
    const s = series({
      rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'FR'] },
      startDate: '2026-10-01',
    });
    const occs = occurrences(s, '2026-10-23', '2026-10-26');
    expect(occs.map((o) => local(o.start, 'Europe/London'))).toEqual([
      '2026-10-23T05:30:00+01:00',
      '2026-10-26T04:30:00+00:00',
    ]);
  });

  it('T6 (property): in Kolkata the local start is always exactly the stored time', () => {
    const startTime = fc
      .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
      .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    const dayOffset = fc.integer({ min: 0, max: 3650 });
    fc.assert(
      fc.property(startTime, dayOffset, (time, offset) => {
        const day = Temporal.PlainDate.from('2020-01-01').add({ days: offset }).toString();
        const s = series({ rule: daily, startDate: '2020-01-01', startTime: time });
        const [occ] = occurrences(s, day, day);
        expect(occ?.dstShifted).toBe(false);
        expect(occ && local(occ.start, 'Asia/Kolkata')).toBe(`${day}T${time}:00+05:30`);
      }),
    );
  });

  it('T8: a date that never existed (Samoa skipped 30 Dec 2011) shifts to the next day, key unchanged', () => {
    const s = series({
      rule: daily,
      startDate: '2011-12-28',
      startTime: '10:00',
      tzid: 'Pacific/Apia',
    });
    const occs = occurrences(s, '2011-12-29', '2011-12-31');
    expect(occs.map((o) => [o.key, local(o.start, o.tzid), o.dstShifted])).toEqual([
      ['s:2011-12-29', '2011-12-29T10:00:00-10:00', false],
      ['s:2011-12-30', '2011-12-31T10:00:00+14:00', true],
      ['s:2011-12-31', '2011-12-31T10:00:00+14:00', false],
    ]);
  });
});
