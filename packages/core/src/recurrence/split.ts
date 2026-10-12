// "This and following": change a series from a date onwards without rewriting its past (D-023).
// Past occurrences carry attendance and sessions, so the old series keeps them untouched
// and a new series takes over from the split date.

import { Temporal } from 'temporal-polyfill';
import type { ISODate, ModifiedOverride, OccurrenceOverride, Series } from '../types.ts';
import { assertValidRule, firstMatchOnOrAfter, occursOn, sameRule, seriesDates } from './dates.ts';

/** What "this and following" may change. Everything else carries over to the new half. */
export type SeriesChanges = Partial<
  Pick<Series, 'title' | 'subject' | 'location' | 'rule' | 'startTime' | 'durationMin' | 'tzid'>
>;

export interface SplitInput {
  series: Series;
  /** The first date the changes apply to. */
  at: ISODate;
  changes: SeriesChanges;
  /** The series' overrides. Others are ignored. */
  overrides: readonly OccurrenceOverride[];
  /** The id for the new half. The caller makes it (a UUIDv7), so this function stays pure. */
  newId: string;
}

/** A description of the database writes, applied later in one transaction. */
export type SplitPlan =
  /** `at` is on or before the series' start, so there's no past to protect: update in place. */
  | { kind: 'in_place'; series: Series; orphaned: string[] }
  /** Nothing of the series is left on or after `at`: just end it the day before. */
  | { kind: 'end_only'; series: Series; orphaned: string[] }
  /** End the old series the day before `at` and start `next`. Move `rekeyed` overrides to it. */
  | { kind: 'split'; old: Series; next: Series; rekeyed: string[]; orphaned: string[] };

/**
 * Plans a split. Pure: it returns the writes instead of doing them.
 * `orphaned` lists overrides whose date the series will no longer generate; the UI asks
 * before applying ("2 changes on Mondays won't apply any more").
 */
export function splitSeries({ series, at, changes, overrides, newId }: SplitInput): SplitPlan {
  const { compare } = Temporal.PlainDate;
  const split = Temporal.PlainDate.from(at);
  const own = overrides.filter(
    (o): o is ModifiedOverride => o.kind === 'modified' && o.seriesId === series.id,
  );
  const ownFrom = (d: Temporal.PlainDate) =>
    own.filter((o) => compare(Temporal.PlainDate.from(o.originalDate), d) >= 0);

  if (compare(split, Temporal.PlainDate.from(series.startDate)) <= 0) {
    const updated = { ...series, ...changes };
    const orphaned = own.filter((o) => !occursOn(updated, o.originalDate));
    return { kind: 'in_place', series: updated, orphaned: orphaned.map((o) => o.id) };
  }

  const until = series.untilDate === null ? null : Temporal.PlainDate.from(series.untilDate);
  const dayBefore = split.subtract({ days: 1 });
  // Clamp: a split after the series has ended must not extend it.
  const oldUntil = until !== null && compare(until, dayBefore) < 0 ? until : dayBefore;
  const old: Series = { ...series, untilDate: oldUntil.toString() };

  // Where the new half starts decides its phase (which weeks "every 2 weeks" falls on).
  // Same rule: its first occurrence on or after the split, so the phase is unchanged.
  // New rule: its first matching day on or after the split, so its phase starts there.
  // (53 weeks is past the next occurrence of even the sparsest rule: every 52 weeks.)
  const newRule = changes.rule;
  if (newRule !== undefined) assertValidRule(newRule);
  const ruleChanged = newRule !== undefined && !sameRule(newRule, series.rule);
  const nextStart = ruleChanged
    ? firstMatchOnOrAfter(newRule, split)
    : seriesDates(series, { from: split, to: split.add({ weeks: 53 }) })[0];

  if (nextStart === undefined || (until !== null && compare(nextStart, until) > 0)) {
    return { kind: 'end_only', series: old, orphaned: ownFrom(split).map((o) => o.id) };
  }

  const next: Series = {
    ...series,
    ...changes,
    id: newId,
    startDate: nextStart.toString(),
    previousSeriesId: series.id,
  };
  const rekeyed: string[] = [];
  const orphaned: string[] = [];
  for (const o of ownFrom(split)) {
    (occursOn(next, o.originalDate) ? rekeyed : orphaned).push(o.id);
  }
  return { kind: 'split', old, next, rekeyed, orphaned };
}
