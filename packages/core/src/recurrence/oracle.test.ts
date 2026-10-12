// Differential test (E10): compare our hand-written expander with rrule-temporal, a full
// RFC 5545 implementation, on random daily and weekly rules. If they ever disagree,
// one of them has a bug, and fast-check shrinks the input to a small example.
//
// rrule-temporal is a dev dependency only: it checks our engine, it never runs in the app.

import fc from 'fast-check';
import { RRuleTemporal } from 'rrule-temporal';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { rule as ruleArb } from '../test/arbitraries.ts';
import type { Rule, Weekday } from '../types.ts';
import { expandDates } from './dates.ts';

const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const basic = (d: Temporal.PlainDate) => d.toString().replaceAll('-', '');

function oracleDates(rule: Rule, start: Temporal.PlainDate, until: Temporal.PlainDate): string[] {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`, `INTERVAL=${rule.interval}`, 'WKST=MO'];
  if (rule.freq === 'weekly') parts.push(`BYDAY=${[...new Set(rule.byDay)].join(',')}`);
  parts.push(`UNTIL=${basic(until)}T100000Z`);
  const rrule = new RRuleTemporal({
    rruleString: `DTSTART;TZID=UTC:${basic(start)}T100000\nRRULE:${parts.join(';')}`,
  });
  return rrule.all().map((zdt) => zdt.toPlainDate().toString());
}

describe('oracle: rrule-temporal', () => {
  it('E10: we generate exactly the dates RFC 5545 does', () => {
    fc.assert(
      fc.property(
        ruleArb,
        fc.integer({ min: 0, max: 3650 }),
        fc.integer({ min: 0, max: 200 }),
        (generated, startOffset, length) => {
          const start = Temporal.PlainDate.from('2020-01-01').add({ days: startOffset });
          let rule = generated;
          // RFC 5545 always counts DTSTART as an occurrence, even when it doesn't match BYDAY.
          // We deliberately don't, so keep the start on the pattern for this comparison.
          if (rule.freq === 'weekly') {
            rule = { ...rule, byDay: [...rule.byDay, WEEKDAYS[start.dayOfWeek - 1] as Weekday] };
          }
          const until = start.add({ days: length });
          const ours = expandDates(
            { rule, startDate: start.toString(), untilDate: until.toString() },
            { from: start.toString(), to: until.toString() },
          );
          expect(ours).toEqual(oracleDates(rule, start, until));
        },
      ),
    );
  });

  it('agrees on a known case (E3), as a sanity check of the oracle itself', () => {
    // Every 2 weeks on Monday from Mon 19 Oct: the oracle must agree before we trust it.
    const rule: Rule = { freq: 'weekly', interval: 2, byDay: ['MO'] };
    const start = Temporal.PlainDate.from('2026-10-19');
    expect(oracleDates(rule, start, Temporal.PlainDate.from('2026-11-30'))).toEqual([
      '2026-10-19',
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ]);
  });
});
