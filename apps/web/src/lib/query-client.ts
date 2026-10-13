// TanStack Query keeps the answers the API gave us (the "server state") in one
// cache, refetches them when they may be out of date, and tells components
// whether they're loading or failed. It is the only client-side cache of API
// data (D-046); the service worker never caches /api.

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.ts';

/**
 * Whether a failed request is worth trying again. A 4xx answer won't change if
 * we ask again (no session stays no session), so give up at once. Network
 * failures and 5xx can be passing blips: try twice more, a second or two apart.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Run requests even when the browser reports it's offline, so a failure
        // shows the offline screen instead of waiting forever. Once v0.2 keeps
        // the cache on disk (D-046), 'offlineFirst' will be the better choice.
        networkMode: 'always',
      },
    },
  });
}
