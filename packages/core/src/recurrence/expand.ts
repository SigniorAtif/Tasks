// Steps 2–4 of the engine: turn generated dates into occurrences for a window.
//
//   rule dates (dates.ts) → day exceptions → overrides → wall clock + zone → instants
//
// Precedence: an explicit action on one occurrence beats a bulk rule, and a bulk rule
// beats the series rule. In code: override > day exception > series rule.

import { Temporal } from 'temporal-polyfill';
import type {
  CancelOrigin,
  CancelReason,
  DateWindow,
  DayException,
  ExtraOverride,
  ModifiedOverride,
  Occurrence,
  OccurrenceKey,
  OccurrenceOverride,
  ScheduleGroup,
  Series,
} from '../types.ts';
import { occursOn, seriesDates } from './dates.ts';
import { extraKey, occurrenceKey } from './keys.ts';

type PlainDate = Temporal.PlainDate;

export interface ExpandInput {
  /** Every group that owns one of `series`. Archived groups too: their past still renders. */
  groups: readonly ScheduleGroup[];
  series: readonly Series[];
  /**
   * Overrides for these series whose original date or new date might fall in the window,
   * plus extras. Overrides for series not in `series` are ignored.
   */
  overrides: readonly OccurrenceOverride[];
  dayExceptions: readonly DayException[];
  /** Inclusive. Occurrences are included by the local date they happen on. */
  window: DateWindow;
}

/** All occurrences in the window, sorted by start time. Pure: same input, same output. */
export function expand(input: ExpandInput): Occurrence[] {
  const from = Temporal.PlainDate.from(input.window.from);
  const to = Temporal.PlainDate.from(input.window.to);
  if (Temporal.PlainDate.compare(from, to) > 0) {
    throw new RangeError(`Window starts after it ends: ${input.window.from} > ${input.window.to}`);
  }
  const inWindow = (d: PlainDate) =>
    Temporal.PlainDate.compare(d, from) >= 0 && Temporal.PlainDate.compare(d, to) <= 0;

  for (const s of input.series) assertZoneName(s.tzid);
  const groups = new Map(input.groups.map((g) => [g.id, g]));
  const groupOf = (s: Series): ScheduleGroup => {
    const g = groups.get(s.groupId);
    if (!g) throw new Error(`Series ${s.id} belongs to group ${s.groupId}, which wasn't passed in`);
    return g;
  };
  const seriesById = new Map(input.series.map((s) => [s.id, s]));
  const days = dayExceptionsByDate(input.dayExceptions);

  const modified = new Map<OccurrenceKey, ModifiedOverride>();
  for (const o of input.overrides) {
    if (o.kind === 'modified') modified.set(occurrenceKey(o.seriesId, o.originalDate), o);
  }

  const out: Resolved[] = [];

  // Pass 1: dates the rule generates inside the window.
  for (const s of input.series) {
    const g = groupOf(s);
    for (const d of seriesDates(s, { from, to }, g)) {
      const occ = resolve(s, g, d, modified.get(occurrenceKey(s.id, d.toString())), days);
      // An occurrence moved to a date outside the window doesn't belong here.
      if (inWindow(occ.date)) out.push(occ);
    }
  }

  // Pass 2: occurrences moved INTO the window from a date outside it.
  // Pass 1 never saw them, because their original date isn't in the window.
  for (const o of input.overrides) {
    if (o.kind !== 'modified' || o.newDate === null) continue;
    const s = seriesById.get(o.seriesId);
    if (!s) continue;
    const original = Temporal.PlainDate.from(o.originalDate);
    if (inWindow(original) || !inWindow(Temporal.PlainDate.from(o.newDate))) continue;
    const g = groupOf(s);
    // An override on a date the series doesn't generate is an orphan (see findOrphans).
    if (!occursOn(s, original, g)) continue;
    out.push(resolve(s, g, original, o, days));
  }

  // Pass 3: extras, such as make-up classes.
  for (const o of input.overrides) {
    if (o.kind !== 'extra') continue;
    const s = seriesById.get(o.seriesId);
    if (s && inWindow(Temporal.PlainDate.from(o.newDate))) out.push(resolveExtra(s, o));
  }

  // Sort by the real moment, then by key so ties come out in the same order every time.
  // (Plain < and >, not localeCompare: string order must not depend on the machine's locale.)
  out.sort((a, b) => {
    if (a.startNs !== b.startNs) return a.startNs < b.startNs ? -1 : 1;
    return a.occurrence.key < b.occurrence.key ? -1 : a.occurrence.key > b.occurrence.key ? 1 : 0;
  });
  return out.map((r) => r.occurrence);
}

/**
 * Overrides whose original date their series no longer generates, for example after a series
 * moved from Mondays to Tuesdays. They're never rendered; the UI shows them before a change
 * that would create them. Group ranges are ignored: an override outside a shortened semester
 * is dormant, not orphaned, and comes back if the semester is extended.
 */
export function findOrphans(
  series: readonly Series[],
  overrides: readonly OccurrenceOverride[],
): ModifiedOverride[] {
  const seriesById = new Map(series.map((s) => [s.id, s]));
  return overrides.filter((o): o is ModifiedOverride => {
    if (o.kind !== 'modified') return false;
    const s = seriesById.get(o.seriesId);
    return s !== undefined && !occursOn(s, o.originalDate);
  });
}

// ---------------------------------------------------------------------------

/** An occurrence plus its start in nanoseconds since 1970, for sorting. */
interface Resolved {
  occurrence: Occurrence;
  startNs: bigint;
  date: PlainDate;
}

/**
 * IANA zone names only (D-025). Temporal itself throws on unknown names like "IST", but it
 * accepts a raw offset like "+05:30" as a fixed zone, which would never follow daylight saving.
 */
function assertZoneName(tzid: string): void {
  if (/^[+-]/.test(tzid)) {
    throw new RangeError(`Use an IANA zone name such as Asia/Kolkata, not an offset: ${tzid}`);
  }
}

/** One exception per day. If two exist for the same day, "not held" beats "skipped". */
function dayExceptionsByDate(rows: readonly DayException[]): Map<string, DayException> {
  const byDay = new Map<string, DayException>();
  for (const row of rows) {
    const existing = byDay.get(row.day);
    if (!existing || (existing.effect === 'skipped' && row.effect === 'not_held')) {
      byDay.set(row.day, row);
    }
  }
  return byDay;
}

/** Applies the layers to one generated date. */
function resolve(
  s: Series,
  g: ScheduleGroup,
  original: PlainDate,
  ov: ModifiedOverride | undefined,
  days: Map<string, DayException>,
): Resolved {
  const newDate = ov?.newDate ?? null;
  const newStartTime = ov?.newStartTime ?? null;
  const date = newDate === null ? original : Temporal.PlainDate.from(newDate);
  const time = Temporal.PlainTime.from(newStartTime ?? s.startTime);
  const moved = !date.equals(original) || !time.equals(Temporal.PlainTime.from(s.startTime));

  let status: Occurrence['status'] = 'scheduled';
  let cancelReason: CancelReason | null = null;
  let cancelOrigin: CancelOrigin | null = null;
  let holidayLabel: string | null = null;

  if (ov?.status === 'cancelled') {
    // Layer 3: the user cancelled this one occurrence.
    status = 'cancelled';
    cancelReason = ov.cancelReason;
    cancelOrigin = 'user';
  } else if (ov?.status !== 'scheduled') {
    // Layer 2: a day exception, unless the user already decided about this occurrence:
    // an explicit "it's on" (status 'scheduled') or a placement on a new date or time.
    const placed = newDate !== null || newStartTime !== null;
    const exception = g.observesHolidays && !placed ? days.get(original.toString()) : undefined;
    if (exception) {
      status = 'cancelled';
      cancelReason = exception.effect;
      cancelOrigin = 'holiday';
      holidayLabel = exception.label;
    }
  }

  return withTimes(
    {
      key: occurrenceKey(s.id, original.toString()),
      seriesId: s.id,
      groupId: s.groupId,
      title: s.title,
      subject: s.subject,
      location: s.location,
      originalDate: original.toString(),
      status,
      cancelReason,
      cancelOrigin,
      holidayLabel,
      moved,
      extra: false,
      confirmedAt: ov?.confirmedAt ?? null,
      note: ov?.note ?? null,
    },
    s.tzid,
    date,
    time,
    ov?.durationMin ?? s.durationMin,
  );
}

/** An extra is exactly what the user placed. Day exceptions and group ranges don't touch it. */
function resolveExtra(s: Series, ov: ExtraOverride): Resolved {
  const cancelled = ov.status === 'cancelled';
  return withTimes(
    {
      key: extraKey(ov.id),
      seriesId: s.id,
      groupId: s.groupId,
      title: s.title,
      subject: s.subject,
      location: s.location,
      originalDate: null,
      status: cancelled ? 'cancelled' : 'scheduled',
      cancelReason: cancelled ? ov.cancelReason : null,
      cancelOrigin: cancelled ? 'user' : null,
      holidayLabel: null,
      moved: false,
      extra: true,
      confirmedAt: ov.confirmedAt,
      note: ov.note,
    },
    s.tzid,
    Temporal.PlainDate.from(ov.newDate),
    Temporal.PlainTime.from(ov.newStartTime),
    ov.durationMin ?? s.durationMin,
  );
}

/**
 * Layer 4: wall clock + zone → real moments.
 *
 * Temporal's default 'compatible' disambiguation handles daylight saving:
 * - a time inside a gap (02:30 on a spring-forward night) moves forward by the gap's length
 *   (03:30), and we flag it instead of dropping the occurrence (D-025);
 * - a time that happens twice (01:30 on a fall-back night) resolves to the first one.
 * The end is the start plus real elapsed minutes, so a 60-minute class lasts 60 minutes
 * even across a transition.
 */
function withTimes(
  base: Omit<Occurrence, 'date' | 'start' | 'end' | 'tzid' | 'dstShifted'>,
  tzid: string,
  date: PlainDate,
  time: Temporal.PlainTime,
  durationMin: number,
): Resolved {
  const wanted = date.toPlainDateTime(time);
  const start = wanted.toZonedDateTime(tzid);
  const end = start.add({ minutes: durationMin });
  return {
    occurrence: {
      ...base,
      date: date.toString(),
      start: start.toInstant().toString(),
      end: end.toInstant().toString(),
      tzid,
      dstShifted: !start.toPlainDateTime().equals(wanted),
    },
    startNs: start.epochNanoseconds,
    date,
  };
}
