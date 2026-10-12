// Step 1 of the engine: which local dates does a rule generate?
// Only calendar dates here (Temporal.PlainDate). Times and zones come later, in expand.ts,
// so nothing in this file can be affected by daylight saving or the machine's time zone.

import { Temporal } from 'temporal-polyfill';
import type { DateWindow, ISODate, Rule, ScheduleGroup, Series, Weekday } from '../types.ts';

type PlainDate = Temporal.PlainDate;

/** The bounds of the group a series belongs to. Both ends inclusive. */
export type ActiveRange = Pick<ScheduleGroup, 'activeFrom' | 'activeTo'>;

/** ISO weekday numbers, the same numbering as Temporal's `dayOfWeek`: Monday = 1, Sunday = 7. */
const WEEKDAY_NUMBER: Record<Weekday, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export const MAX_INTERVAL = { daily: 365, weekly: 52 } as const;

const { compare } = Temporal.PlainDate;
const earlier = (a: PlainDate, b: PlainDate) => (compare(a, b) <= 0 ? a : b);
const later = (a: PlainDate, b: PlainDate) => (compare(a, b) >= 0 ? a : b);
const mondayOf = (d: PlainDate) => d.subtract({ days: d.dayOfWeek - 1 });
const daysBetween = (a: PlainDate, b: PlainDate) => a.until(b, { largestUnit: 'days' }).days;

/**
 * Throws if the rule could make the engine misbehave (an interval of 0 would loop forever).
 * The API validates input properly with zod; this is the engine's own last line of defence.
 */
export function assertValidRule(rule: Rule): void {
  if (rule.freq !== 'daily' && rule.freq !== 'weekly') {
    throw new RangeError(`Unsupported rule frequency: ${String((rule as { freq: unknown }).freq)}`);
  }
  const max = MAX_INTERVAL[rule.freq];
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > max) {
    throw new RangeError(`A ${rule.freq} interval must be a whole number from 1 to ${max}`);
  }
  if (rule.freq === 'weekly') {
    if (rule.byDay.length === 0) throw new RangeError('A weekly rule needs at least one day');
    for (const day of rule.byDay) {
      if (!Object.hasOwn(WEEKDAY_NUMBER, day)) throw new RangeError(`Unknown weekday: ${day}`);
    }
  }
}

/**
 * Every date in [lo, hi] that `rule` generates, ascending, when its phase is anchored on `anchor`.
 * "Every 2 weeks" counts weeks from the Monday of the anchor's week; "every 3 days" counts days
 * from the anchor itself. The caller guarantees `anchor <= lo`.
 */
export function ruleDates(
  rule: Rule,
  anchor: PlainDate,
  lo: PlainDate,
  hi: PlainDate,
): PlainDate[] {
  const out: PlainDate[] = [];
  if (compare(lo, hi) > 0) return out;

  if (rule.freq === 'daily') {
    // Jump straight to the first aligned day >= lo: the loop costs one step per occurrence,
    // not one per day.
    const steps = Math.ceil(daysBetween(anchor, lo) / rule.interval);
    for (
      let d = anchor.add({ days: steps * rule.interval });
      compare(d, hi) <= 0;
      d = d.add({ days: rule.interval })
    ) {
      out.push(d);
    }
    return out;
  }

  const days = [...new Set(rule.byDay)].map((day) => WEEKDAY_NUMBER[day]).sort((a, b) => a - b);
  const anchorWeek = mondayOf(anchor);
  let week = mondayOf(lo);
  // Both are Mondays, so this division is exact.
  const weeksSinceAnchor = daysBetween(anchorWeek, week) / 7;
  const offPhase = weeksSinceAnchor % rule.interval;
  if (offPhase !== 0) week = week.add({ weeks: rule.interval - offPhase });

  for (; compare(week, hi) <= 0; week = week.add({ weeks: rule.interval })) {
    for (const dayNumber of days) {
      const d = week.add({ days: dayNumber - 1 });
      if (compare(d, lo) >= 0 && compare(d, hi) <= 0) out.push(d);
    }
  }
  return out;
}

/**
 * The dates a series generates inside `window`, clipped to its own start/until dates and,
 * if given, to its group's active range. The phase always comes from the series' start date,
 * never from the clipped start, so a fortnightly lab stays in the same weeks however it's clipped.
 */
export function seriesDates(
  series: Pick<Series, 'rule' | 'startDate' | 'untilDate'>,
  window: { from: PlainDate; to: PlainDate },
  group?: ActiveRange,
): PlainDate[] {
  assertValidRule(series.rule);
  const start = Temporal.PlainDate.from(series.startDate);
  let lo = later(window.from, start);
  let hi = window.to;
  if (series.untilDate !== null) hi = earlier(hi, Temporal.PlainDate.from(series.untilDate));
  if (group) {
    lo = later(lo, Temporal.PlainDate.from(group.activeFrom));
    if (group.activeTo !== null) hi = earlier(hi, Temporal.PlainDate.from(group.activeTo));
  }
  return ruleDates(series.rule, start, lo, hi);
}

/** String-in, string-out version of `seriesDates`, for callers outside the engine. */
export function expandDates(
  series: Pick<Series, 'rule' | 'startDate' | 'untilDate'>,
  window: DateWindow,
  group?: ActiveRange,
): ISODate[] {
  const from = Temporal.PlainDate.from(window.from);
  const to = Temporal.PlainDate.from(window.to);
  return seriesDates(series, { from, to }, group).map((d) => d.toString());
}

/** Whether the series (and its group, if given) generates an occurrence on `date`. */
export function occursOn(
  series: Pick<Series, 'rule' | 'startDate' | 'untilDate'>,
  date: ISODate | PlainDate,
  group?: ActiveRange,
): boolean {
  const d = typeof date === 'string' ? Temporal.PlainDate.from(date) : date;
  return seriesDates(series, { from: d, to: d }, group).length === 1;
}

/**
 * Turns "ends after `count` times" into an inclusive until date, which is what gets stored
 * (D-023: a count can't be split cleanly, an end date can).
 */
export function untilDateForCount(rule: Rule, startDate: ISODate, count: number): ISODate {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('count must be a whole number of at least 1');
  }
  assertValidRule(rule);
  const start = Temporal.PlainDate.from(startDate);
  // Enough days to be sure of `count` dates. Weekly: the start's own week may contribute
  // nothing (its days can fall before the start), and every later "on" week contributes
  // at least one date.
  const span = rule.freq === 'daily' ? (count - 1) * rule.interval : count * rule.interval * 7 + 6;
  const last = ruleDates(rule, start, start, start.add({ days: span }))[count - 1];
  if (last === undefined) throw new Error('unreachable: the span always holds `count` dates');
  return last.toString();
}

/** Whether two rules generate the same dates from the same anchor. */
export function sameRule(a: Rule, b: Rule): boolean {
  if (a.freq !== b.freq || a.interval !== b.interval) return false;
  if (a.freq === 'daily' || b.freq === 'daily') return true;
  const days = (r: { byDay: Weekday[] }) => [...new Set(r.byDay)].sort().join(',');
  return days(a) === days(b);
}

/** The first date on or after `from` whose weekday the rule uses. For daily rules, `from` itself. */
export function firstMatchOnOrAfter(rule: Rule, from: PlainDate): PlainDate {
  if (rule.freq === 'daily') return from;
  const ahead = rule.byDay.map((day) => (WEEKDAY_NUMBER[day] - from.dayOfWeek + 7) % 7);
  return from.add({ days: Math.min(...ahead) });
}
