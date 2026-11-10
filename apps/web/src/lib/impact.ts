// What a change to a group or series would hide, for their forms: the server's
// count (`GET .../impact`, which sees every date, where the phone holds only the
// weeks it has loaded) and the sentences a form shows before saving. The same
// read says whether Delete would lose anything (`useHasHistory`).

import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import type { Impact, ISODate, SeriesImpact, SeriesImpactQuery } from '@tasks/core';
import { dateLabel } from '../calendar/model/format.ts';
import { apiGet } from './api.ts';

/**
 * A date box's value while its year is still being typed: typing 2026 sets
 * 0002-11-20, then 0020-…, then 0202-… before 2026-11-20. Asking about those
 * would flash a count for the year 2. No class is dated before the year 1000.
 */
const halfTyped = (date: ISODate | undefined) => date !== undefined && date < '1000';

/**
 * What the change in `ask` would hide in the row at `rowPath` (`/api/v1/groups/<id>`,
 * asked only about a `lastDay` and answered with an `Impact`, or `/api/v1/series/<id>`,
 * with a `SeriesImpact`). Without both, or while a year is half typed, it asks
 * nothing. An empty `ask` asks about no change: only `hasHistory` matters then. Not kept for offline (persist.ts): a form asks again each time it opens.
 */
export function impactQuery<T extends Impact = Impact>(
  rowPath: string | null,
  ask: SeriesImpactQuery | undefined,
) {
  return queryOptions({
    queryKey: ['impact', rowPath, ask],
    // Dropped as soon as no form shows it: a count from an earlier visit could
    // be out of date (a new cancel, another last day) and flash before the refetch.
    gcTime: 0,
    queryFn:
      rowPath === null || ask === undefined || halfTyped(ask.lastDay) || halfTyped(ask.firstDay)
        ? skipToken
        : ({ signal }) => {
            // String() writes the days as `MO,FR`, the way the query string has them.
            const search = Object.entries(ask).map(([key, value]) => [key, String(value)]);
            return apiGet<T>(`${rowPath}/impact?${new URLSearchParams(search)}`, { signal });
          },
  });
}

/** "3 changes after 27 Nov 2026 will stop showing. A later date brings them back." */
function note(count: number, where: string, undo: string): string | undefined {
  if (count === 0) return undefined;
  const changes = count === 1 ? '1 change' : `${count} changes`;
  const them = count === 1 ? 'it' : 'them';
  return `${changes} ${where} will stop showing. ${undo} brings ${them} back.`;
}

/** "3 changes after 27 Nov 2026 will stop showing…", or nothing when it hides none. */
export function hiddenChangesNote(changesAfter: number, lastDay: ISODate): string | undefined {
  return note(changesAfter, `after ${dateLabel(lastDay)}`, 'A later date');
}

/** A series form's warnings, each under the field it's about. */
export interface SeriesChangeNotes {
  firstDay?: string | undefined;
  lastDay?: string | undefined;
  timing?: string | undefined;
}

/** The warning for each part of `ask` that hides something. */
export function seriesChangeNotes(impact: SeriesImpact, ask: SeriesImpactQuery): SeriesChangeNotes {
  const { firstDay, lastDay, byDay } = ask;
  const notes: SeriesChangeNotes = {};
  if (firstDay !== undefined) {
    const lines = [note(impact.changesBefore, `before ${dateLabel(firstDay)}`, 'An earlier date')];
    // Every 2 weeks counts from the first day's week, so a new first day alone can
    // move the class off a change's week. With a new timing, its own warning says so.
    if (byDay === undefined) {
      lines.push(
        note(impact.changesOffTiming, 'in weeks the class no longer meets', 'The old first day'),
      );
    }
    notes.firstDay = lines.filter(Boolean).join(' ') || undefined;
  }
  if (lastDay !== undefined) notes.lastDay = hiddenChangesNote(impact.changesAfter, lastDay);
  if (byDay !== undefined) {
    notes.timing = note(
      impact.changesOffTiming,
      "on days the new timing doesn't produce",
      'The old timing',
    );
  }
  return notes;
}

/**
 * The note for a last day a form is about to save: `lastDay` as typed (or
 * Archive's day; '' or `undefined` for none) and `saved`, the row's own ('' for
 * none). Asks only about a saved row, and only once the date differs from its own.
 */
export function useHiddenChangesNote(
  rowPath: string | null,
  lastDay: string | undefined,
  saved: string,
): string | undefined {
  const asking = lastDay !== undefined && lastDay !== '' && lastDay !== saved ? lastDay : undefined;
  const { data } = useQuery(
    impactQuery(rowPath, asking === undefined ? undefined : { lastDay: asking }),
  );
  if (data === undefined || asking === undefined) return undefined;
  return hiddenChangesNote(data.changesAfter, asking);
}

/**
 * Whether deleting the saved row at `rowPath` would lose anything (`Impact.hasHistory`).
 * `undefined` until the answer is in, and if it never comes.
 */
export function useHasHistory(rowPath: string | null): boolean | undefined {
  return useQuery(impactQuery(rowPath, {})).data?.hasHistory;
}

/** The series form's warnings for `ask`, what its edit would change (`undefined`: nothing). */
export function useSeriesChangeNotes(
  rowPath: string | null,
  ask: SeriesImpactQuery | undefined,
): SeriesChangeNotes {
  const { data } = useQuery(impactQuery<SeriesImpact>(rowPath, ask));
  if (data === undefined || ask === undefined) return {};
  return seriesChangeNotes(data, ask);
}
