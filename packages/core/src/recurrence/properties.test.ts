// Property tests: instead of one hand-picked example, state a rule that must hold for every
// input, and let fast-check try 1,000 random ones (see src/test/setup.ts).

import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { rule as ruleArb, SPAN, seriesWith, threeDays, world } from '../test/arbitraries.ts';
import { cancel } from '../test/builders.ts';
import type { Occurrence, Weekday } from '../types.ts';
import { expandDates } from './dates.ts';
import { expand, findOrphans } from './expand.ts';
import { splitSeries } from './split.ts';

const byKey = (a: Occurrence, b: Occurrence) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

describe('properties', () => {
  it('E11: dates come out ascending, unique, inside the window, and on the rule', () => {
    fc.assert(
      fc.property(seriesWith('s', 'g'), threeDays, (s, [from, , to]) => {
        const dates = expandDates(s, { from: from.toString(), to: to.toString() });
        const start = Temporal.PlainDate.from(s.startDate);
        for (const [i, iso] of dates.entries()) {
          const d = Temporal.PlainDate.from(iso);
          const previous = dates[i - 1];
          if (previous !== undefined) expect(iso > previous).toBe(true);
          expect(
            Temporal.PlainDate.compare(d, from) >= 0 && Temporal.PlainDate.compare(d, to) <= 0,
          ).toBe(true);
          expect(Temporal.PlainDate.compare(d, start) >= 0).toBe(true);
          if (s.untilDate !== null) expect(iso <= s.untilDate).toBe(true);
          if (s.rule.freq === 'weekly') {
            expect(s.rule.byDay).toContain(WEEKDAYS[d.dayOfWeek - 1]);
          } else {
            expect(start.until(d).days % s.rule.interval).toBe(0);
          }
        }
      }),
    );
  });

  it('E9: expanding a..c equals expanding a..b plus b+1..c, moves and extras included', () => {
    fc.assert(
      fc.property(world, threeDays, (w, [a, b, c]) => {
        const at = (from: Temporal.PlainDate, to: Temporal.PlainDate) =>
          expand({ ...w, window: { from: from.toString(), to: to.toString() } });
        const whole = at(a, c);
        const parts = [...at(a, b), ...at(b.add({ days: 1 }), c)];
        expect(parts.sort(byKey)).toEqual(whole.sort(byKey));
      }),
    );
  });

  it('determinism: the order of the inputs never changes the output', () => {
    fc.assert(
      fc.property(
        world.chain((w) =>
          fc.record({
            original: fc.constant(w),
            shuffled: fc.record({
              groups: fc.shuffledSubarray(w.groups, { minLength: w.groups.length }),
              series: fc.shuffledSubarray(w.series, { minLength: w.series.length }),
              overrides: fc.shuffledSubarray(w.overrides, { minLength: w.overrides.length }),
              dayExceptions: fc.shuffledSubarray(w.dayExceptions, {
                minLength: w.dayExceptions.length,
              }),
            }),
          }),
        ),
        ({ original, shuffled }) => {
          expect(expand({ ...shuffled, window: SPAN })).toEqual(
            expand({ ...original, window: SPAN }),
          );
        },
      ),
    );
  });

  it('cancel locality: cancelling one occurrence changes that occurrence and nothing else', () => {
    fc.assert(
      fc.property(world, fc.nat(), (w, pick) => {
        const before = expand({ ...w, window: SPAN });
        const touched = new Set(
          w.overrides.map((o) => (o.kind === 'modified' ? `${o.seriesId}:${o.originalDate}` : '')),
        );
        const candidates = before.filter((o) => !o.extra && !touched.has(o.key));
        fc.pre(candidates.length > 0);
        const target = candidates[pick % candidates.length] as Occurrence;

        const added = cancel(target.seriesId, target.originalDate as string, 'skipped');
        const after = expand({ ...w, overrides: [...w.overrides, added], window: SPAN });

        expect(after.map((o) => o.key)).toEqual(before.map((o) => o.key));
        for (const [i, occ] of after.entries()) {
          if (occ.key === target.key) {
            expect(occ).toEqual({
              ...before[i],
              status: 'cancelled',
              cancelReason: 'skipped',
              cancelOrigin: 'user',
              holidayLabel: null,
            });
          } else {
            expect(occ).toEqual(before[i]);
          }
        }
      }),
    );
  });

  it('notes are inert: writing a note on every override changes only the notes', () => {
    fc.assert(
      fc.property(world, (w) => {
        const withNotes = w.overrides.map((o) => ({ ...o, note: `note on ${o.id}` }));
        const before = expand({ ...w, window: SPAN });
        const after = expand({ ...w, overrides: withNotes, window: SPAN });
        expect(after.map((o) => ({ ...o, note: null }))).toEqual(
          before.map((o) => ({ ...o, note: null })),
        );
      }),
    );
  });

  it('S5: splitting with no changes leaves every occurrence where it was', () => {
    fc.assert(
      fc.property(world, fc.integer({ min: 0, max: 119 }), (w, splitOffset) => {
        const [first, ...rest] = w.series;
        if (first === undefined) return;
        const at = Temporal.PlainDate.from(SPAN.from).add({ days: splitOffset }).toString();
        const plan = splitSeries({
          series: first,
          at,
          changes: {},
          overrides: w.overrides,
          newId: 'next',
        });
        // No new orphans. (An override that was already on a date the rule never generates
        // stays an orphan, and the split reports it again.)
        const alreadyOrphaned = findOrphans([first], w.overrides).map((o) => o.id);
        for (const id of plan.orphaned) expect(alreadyOrphaned).toContain(id);

        const series =
          plan.kind === 'split' ? [plan.old, plan.next, ...rest] : [plan.series, ...rest];
        const moved = new Set(plan.kind === 'split' ? plan.rekeyed : []);
        const overrides = w.overrides.map((o) =>
          moved.has(o.id) ? { ...o, seriesId: 'next' } : o,
        );

        // The split changes which series an occurrence belongs to (and so its key),
        // but never when it happens or what state it's in.
        const what = (o: Occurrence) =>
          [
            o.originalDate,
            o.date,
            o.start,
            o.end,
            o.status,
            o.cancelReason,
            o.cancelOrigin,
            o.moved,
            o.extra,
          ].join(' ');
        const before = expand({ ...w, window: SPAN })
          .map(what)
          .sort();
        const after = expand({ ...w, series, overrides, window: SPAN })
          .map(what)
          .sort();
        expect(after).toEqual(before);
      }),
    );
  });

  it('every generated rule is accepted by the engine', () => {
    fc.assert(
      fc.property(ruleArb, (r) => {
        expect(() =>
          expandDates({ rule: r, startDate: SPAN.from, untilDate: null }, SPAN),
        ).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
