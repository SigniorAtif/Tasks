// The API reads the screens use, as TanStack Query options. A route's
// `beforeLoad` and a component can share one definition, so they share one
// cache entry (same `queryKey`).

import { queryOptions } from '@tanstack/react-query';
import { type Me, paths } from '@tasks/core';
import { apiGet } from './api.ts';

/** The signed-in user. Fails with an `unauthenticated` ApiError when nobody is. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: ({ signal }) => apiGet<Me>(paths.me, { signal }),
});
