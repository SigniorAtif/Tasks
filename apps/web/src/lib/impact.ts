// What a new last day would hide, for the group and series forms: the
// server's count (`GET .../impact`, which sees every date, where the phone
// holds only the weeks it has loaded) and the sentence a form shows before
// saving.

import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import type { Impact, ISODate } from '@tasks/core';
import { dateLabel } from '../calendar/model/format.ts';
import { apiGet } from './api.ts';

/**
 * What giving the row at `rowPath` (`/api/v1/groups/<id>` or `/api/v1/series/<id>`)
 * the last day `lastDay` would hide. Without both, it asks nothing. Not kept for
 * offline (persist.ts): a form asks again each time it opens.
 */
export function impactQuery(rowPath: string | null, lastDay: ISODate | undefined) {
  return queryOptions({
    queryKey: ['impact', rowPath, lastDay],
    // Dropped as soon as no form shows it: a count from an earlier visit could
    // be out of date (a new cancel, another last day) and flash before the refetch.
    gcTime: 0,
    queryFn:
      rowPath === null || lastDay === undefined
        ? skipToken
        : ({ signal }) =>
            apiGet<Impact>(`${rowPath}/impact?${new URLSearchParams({ lastDay })}`, { signal }),
  });
}

/** "3 changes after 27 Nov 2026 will stop showing…", or nothing when it hides none. */
export function hiddenChangesNote(changesAfter: number, lastDay: ISODate): string | undefined {
  if (changesAfter === 0) return undefined;
  const changes = changesAfter === 1 ? '1 change' : `${changesAfter} changes`;
  const them = changesAfter === 1 ? 'it' : 'them';
  return `${changes} after ${dateLabel(lastDay)} will stop showing. A later date brings ${them} back.`;
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
  const { data } = useQuery(impactQuery(rowPath, asking));
  if (data === undefined || asking === undefined) return undefined;
  return hiddenChangesNote(data.changesAfter, asking);
}
