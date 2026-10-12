// The API reads the screens use, as TanStack Query options. A route's
// `beforeLoad` and a component can share one definition, so they share one
// cache entry (same `queryKey`).

import { queryOptions } from '@tanstack/react-query';
import { type Healthz, type Me, paths } from '@tasks/core';
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
