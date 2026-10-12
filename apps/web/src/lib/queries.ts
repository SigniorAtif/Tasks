// The API reads the screens use, as TanStack Query options. A route's
// `beforeLoad` and a component can share one definition, so they share one
// cache entry (same `queryKey`).

import { queryOptions } from '@tanstack/react-query';
import {
  type CalendarResponse,
  type DateWindow,
  type GroupList,
  type Healthz,
  type Me,
  paths,
  type SeriesList,
} from '@tasks/core';
import { apiGet } from './api.ts';

/** The signed-in user. Fails with an `unauthenticated` ApiError when nobody is. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: ({ signal }) => apiGet<Me>(paths.me, { signal }),
  // While the screen is open (and the app in front), ask again every minute:
  // it re-syncs the server clock and notices a session that has ended.
  refetchInterval: 60_000,
});

/** Which commit the server runs, and whether its database answers. Public. */
export const healthzQuery = queryOptions({
  queryKey: ['healthz'],
  // 503 still carries a `Healthz` body (the database is down, the server isn't).
  queryFn: ({ signal }) => apiGet<Healthz>(paths.healthz, { signal, okStatuses: [503] }),
  // Every minute, and whenever the app comes back to the front (TanStack
  // Query's default), so a new deploy's commit shows up without a reload.
  refetchInterval: 60_000,
});

/** Every group the user has, archived ones too: names and colours for the calendar and forms. */
export const groupsQuery = queryOptions({
  queryKey: ['groups'],
  queryFn: ({ signal }) => apiGet<GroupList>(paths.groups, { signal }),
});

/** Every series in every group, for editing them. */
export const seriesListQuery = queryOptions({
  queryKey: ['series'],
  queryFn: ({ signal }) => apiGet<SeriesList>(paths.series, { signal }),
});

/**
 * The occurrences the server computed for one window (both days included, at
 * most 62 days). Each window is its own cache entry, so a week that was seen
 * once can be shown again straight away, and offline once the cache is kept on
 * disk. Anything that changes a series must invalidate the `['calendar']` prefix.
 */
export function calendarQuery(window: DateWindow) {
  return queryOptions({
    queryKey: ['calendar', window.from, window.to],
    queryFn: ({ signal }) =>
      apiGet<CalendarResponse>(
        `${paths.calendar}?${new URLSearchParams({ from: window.from, to: window.to })}`,
        { signal },
      ),
  });
}
