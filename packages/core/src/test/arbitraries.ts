// Random inputs for property tests. fast-check builds values from these recipes and,
// when a property fails, shrinks the input to the smallest one that still fails.

import fc from 'fast-check';
import { Temporal } from 'temporal-polyfill';
import { expandDates } from '../recurrence/dates.ts';
import type {
  DayException,
  OccurrenceOverride,
  Rule,
  ScheduleGroup,
  Series,
  Weekday,
} from '../types.ts';
import { cancel, dayOff, extra, group, modified, series } from './builders.ts';

/** Every date in these tests falls in the 120 days from here. */
export const SPAN_START = Temporal.PlainDate.from('2026-01-01');
export const SPAN_DAYS = 120;
export const SPAN = {
  from: SPAN_START.toString(),
  to: SPAN_START.add({ days: SPAN_DAYS - 1 }).toString(),
};

export const dayInSpan = (min = 0, max = SPAN_DAYS - 1) =>
  fc.integer({ min, max }).map((n) => SPAN_START.add({ days: n }).toString());

export const weekday = fc.constantFrom<Weekday>('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU');

export const rule: fc.Arbitrary<Rule> = fc.oneof(
  fc.record({ freq: fc.constant('daily' as const), interval: fc.integer({ min: 1, max: 10 }) }),
  fc.record({
    freq: fc.constant('weekly' as const),
    interval: fc.integer({ min: 1, max: 5 }),
    // Duplicates on purpose: the engine must ignore them.
    byDay: fc.array(weekday, { minLength: 1, maxLength: 7 }),
  }),
);

export const wallTime = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** Zones with and without daylight saving, including a 30-minute one. */
export const tzid = fc.constantFrom(
  'Asia/Kolkata',
  'America/New_York',
  'Europe/London',
  'Australia/Lord_Howe',
  'UTC',
);

export const seriesWith = (id: string, groupId: string): fc.Arbitrary<Series> =>
  fc
    .record({
      rule,
      start: fc.integer({ min: 0, max: 60 }),
      length: fc.option(fc.integer({ min: 0, max: 90 }), { nil: null }),
      startTime: wallTime,
      durationMin: fc.integer({ min: 5, max: 180 }),
      tzid,
    })
    .map(({ start, length, ...fields }) =>
      series({
        id,
        groupId,
        ...fields,
        startDate: SPAN_START.add({ days: start }).toString(),
        untilDate: length === null ? null : SPAN_START.add({ days: start + length }).toString(),
      }),
    );

/** Two groups: one observes holidays, one doesn't. Their active ranges vary. */
export const groups: fc.Arbitrary<ScheduleGroup[]> = fc
  .tuple(
    dayInSpan(0, 30),
    fc.option(dayInSpan(60), { nil: null }),
    fc.option(dayInSpan(60), { nil: null }),
  )
  .map(([from, toG, toH]) => [
    group({ id: 'g', activeFrom: from, activeTo: toG, observesHolidays: true }),
    group({ id: 'h', activeFrom: SPAN.from, activeTo: toH, observesHolidays: false }),
  ]);

/** A random override on one of the series' real dates, or occasionally a stray one. */
function overridesFor(s: Series): fc.Arbitrary<OccurrenceOverride[]> {
  const dates = expandDates(s, SPAN);
  const date = dates.length > 0 ? fc.oneof(fc.constantFrom(...dates), dayInSpan()) : dayInSpan();
  const one: fc.Arbitrary<OccurrenceOverride> = fc.oneof(
    date.chain((d) =>
      fc
        .constantFrom<'not_held' | 'skipped' | null>('not_held', 'skipped', null)
        .map((r) => cancel(s.id, d, r)),
    ),
    fc
      .tuple(date, fc.option(dayInSpan(), { nil: null }), fc.option(wallTime, { nil: null }))
      .map(([d, nd, nt]) => modified(s.id, d, { newDate: nd, newStartTime: nt })),
    date.map((d) => modified(s.id, d, { status: 'scheduled' })),
    date.map((d) => modified(s.id, d, { note: 'Bring the lab manual' })),
    fc.tuple(fc.uuid(), dayInSpan(), wallTime).map(([id, d, t]) => extra(id, s.id, d, t)),
  );
  // One override per (series, date), like the database's unique key.
  return fc.uniqueArray(one, {
    maxLength: 6,
    selector: (o) => (o.kind === 'modified' ? `${o.seriesId}:${o.originalDate}` : o.id),
  });
}

export interface World {
  groups: ScheduleGroup[];
  series: Series[];
  overrides: OccurrenceOverride[];
  dayExceptions: DayException[];
}

/** One to three series across two groups, with overrides and day exceptions. */
export const world: fc.Arbitrary<World> = fc
  .tuple(
    groups,
    fc.array(fc.constantFrom('g', 'h'), { minLength: 1, maxLength: 3 }),
    fc.uniqueArray(
      fc
        .tuple(dayInSpan(), fc.constantFrom<'not_held' | 'skipped'>('not_held', 'skipped'))
        .map(([d, e]) => dayOff(d, e)),
      { maxLength: 4, selector: (d) => d.id },
    ),
  )
  .chain(([gs, groupIds, dayExceptions]) =>
    fc.tuple(...groupIds.map((g, i) => seriesWith(`s${i}`, g))).chain((ss) =>
      fc.tuple(...ss.map(overridesFor)).map((os) => ({
        groups: gs,
        series: ss,
        overrides: os.flat(),
        dayExceptions,
      })),
    ),
  );

/** Three ordered days a <= b < c inside the span: windows a..b and b+1..c tile a..c. */
export const threeDays = fc
  .tuple(
    fc.integer({ min: 0, max: SPAN_DAYS - 2 }),
    fc.integer({ min: 0, max: 60 }),
    fc.integer({ min: 1, max: 60 }),
  )
  .map(([a, ab, bc]) => {
    const b = Math.min(a + ab, SPAN_DAYS - 2);
    const c = Math.min(b + bc, SPAN_DAYS - 1);
    return [a, b, c].map((n) => SPAN_START.add({ days: n })) as [
      Temporal.PlainDate,
      Temporal.PlainDate,
      Temporal.PlainDate,
    ];
  });
