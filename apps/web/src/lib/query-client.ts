// TanStack Query keeps the answers the API gave us (the "server state") in one
// cache, refetches them when they may be out of date, and tells components
// whether they're loading or failed. It is the only client-side cache of API
// data (D-046); the service worker never caches /api. From v0.2 a copy of the
// cache is also kept on the device (src/lib/persist.ts), so it opens offline.

import { onlineManager, QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './api.ts';

/**
 * Whether a failed request is worth trying again. A 4xx answer won't change if
 * we ask again (no session stays no session), so give up at once. Network
 * failures and 5xx can be passing blips: try twice more, a second or two apart.
 *
 * Except when the browser has said it went offline: under `offlineFirst` a retry
 * then waits, paused, until the connection is back, and a screen waiting for it
 * would spin forever. Failing at once lets it say "You're offline" instead; the
 * query is fetched again when the connection returns anyway.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  if (error instanceof NetworkError && !onlineManager.isOnline()) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Try the request once even when the browser says it's offline (it
        // can be wrong, say on Wi-Fi that needs a login page), then follow the
        // retry rule above. Until an answer comes, screens show the copy
        // restored from the device, which is what 'offlineFirst' is for.
        networkMode: 'offlineFirst',
        // How long a query nobody is showing stays in memory. It must be at
        // least as long as the saved copy is kept (30 days), or restored weeks
        // would be dropped from memory, and then from the saved copy, minutes
        // after the app opens. Not 30 days itself: browsers keep timer delays
        // in 32 bits, so anything over about 24.8 days fires at once. Never
        // collecting is safe here: the cache is small, and persist.ts drops
        // answers older than 30 days when it saves.
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: {
        // Writes are online-only in v0.2 (D-048). The default ('online') would
        // hold a write made offline and send it later, maybe after the user
        // has left the screen. Sending it at once fails fast with a
        // NetworkError, which the form shows.
        networkMode: 'always',
      },
    },
  });
}
