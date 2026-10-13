// Keeping the query cache on the phone, so the app opens offline (D-046, D-048).
//
// TanStack Query's cache lives in memory and is gone when the app closes. Here
// a "persister" writes a copy of it to IndexedDB (the browser's database on the
// device) about a second after every change, and puts it back into memory when
// the app starts. So on a train with no signal, the app still opens with your
// name and the weeks you looked at recently, and a badge says when they were
// last fetched.
//
// The service worker still never caches /api: this copy is the only one (D-046).

import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query, QueryClient } from '@tanstack/react-query';
import {
  type AsyncStorage,
  type PersistedClient,
  persistQueryClient,
} from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

/**
 * Change this when the shape of cached data changes (a renamed field in `Me`, say).
 * A copy saved under another buster is thrown away instead of being restored, so
 * a new version of the app never reads old shapes it doesn't understand.
 */
export const CACHE_BUSTER = 'v0.2.0';

/** How long a saved answer stays usable offline: 30 days. Older ones are dropped. */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long the app waits for the saved copy before drawing anyway. Reading
 * IndexedDB takes a few milliseconds; this only matters if it's broken (some
 * private modes, a full disk), which must never leave the app on a blank page.
 */
export const RESTORE_TIMEOUT_MS = 1_000;

/** The reads worth having offline: who you are, your groups, your series, your weeks. */
const PERSISTED_KEYS: ReadonlySet<unknown> = new Set(['me', 'groups', 'series', 'calendar']);

/** The IndexedDB key the whole saved cache is stored under. */
const STORAGE_KEY = 'tasks-query-cache';

/**
 * Whether one cached query goes into the saved copy. Only the keys above (never
 * `healthz`); only queries holding an answer (one that never worked has nothing
 * to show later); and only answers from the last `CACHE_MAX_AGE_MS`, so weeks
 * you stopped looking at fall out instead of piling up forever.
 *
 * Not "only successful ones", TanStack Query's default: a refetch that fails
 * offline marks the query `error` but keeps its answer. Dropping it then would
 * delete the very copy the next offline open needs.
 */
export function shouldPersistQuery(
  query: Pick<Query, 'queryKey' | 'state'>,
  now: number = Date.now(),
): boolean {
  return (
    PERSISTED_KEYS.has(query.queryKey[0]) &&
    query.state.data !== undefined &&
    now - query.state.dataUpdatedAt <= CACHE_MAX_AGE_MS
  );
}

/** What goes into the saved copy. */
export const dehydrateOptions = {
  shouldDehydrateQuery: (query: Query) => shouldPersistQuery(query),
  // Writes are online-only in v0.2 (D-048): no queued mutation is ever saved.
  shouldDehydrateMutation: () => false,
};

/**
 * Saves each query as its last good answer: a query whose latest refetch failed
 * is stored as a plain success with that answer, without the failure. The
 * failure belongs to that moment (and an error object doesn't survive JSON
 * anyway); restored, the answer is shown and fetched again as usual.
 */
export function lastGoodAnswers(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries.map((query) =>
    query.state.status === 'error'
      ? {
          ...query,
          state: {
            ...query.state,
            status: 'success' as const,
            error: null,
            fetchFailureCount: 0,
            fetchFailureReason: null,
          },
        }
      : query,
  );
  return { ...client, clientState: { ...client.clientState, queries } };
}

/** The three `idb-keyval` functions the persister needs. Tests pass an in-memory map instead. */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

/** Adapts a key-value store to the `getItem`/`setItem`/`removeItem` names the persister expects. */
export function toAsyncStorage(store: KeyValueStore): AsyncStorage<string> {
  return {
    getItem: (key) => store.get(key),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.del(key),
  };
}

/**
 * The persister: saves the whole cache as one JSON string under one key.
 * `throttleTime`: save at most once per that many ms, so a refetch of every
 * query on screen is one write, not ten.
 */
export function createPersister(store: KeyValueStore, throttleTime = 1_000) {
  return createAsyncStoragePersister({
    storage: toAsyncStorage(store),
    key: STORAGE_KEY,
    throttleTime,
    serialize: (client) => JSON.stringify(lastGoodAnswers(client)),
  });
}

/** `idb-keyval`'s default database (`keyval-store`), opened the first time it's used. */
const persister = createPersister({ get, set, del });

/**
 * Puts the saved copy back into `queryClient`, then keeps saving it after every
 * change. Resolves when the copy is back, or after `timeoutMs` if IndexedDB is
 * slow or broken; never rejects, so `main.tsx` can always go on to draw the app.
 *
 * On a timeout the restore carries on in the background. If it finishes later,
 * an older saved answer never replaces a newer one already fetched.
 */
export async function restoreQueryCache(
  queryClient: QueryClient,
  timeoutMs: number = RESTORE_TIMEOUT_MS,
): Promise<void> {
  const [, restored] = persistQueryClient({
    queryClient,
    persister,
    buster: CACHE_BUSTER,
    maxAge: CACHE_MAX_AGE_MS,
    dehydrateOptions,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  // A failed restore has already deleted the broken copy; start from an empty cache.
  await Promise.race([restored.catch(() => undefined), timeout]);
  clearTimeout(timer);
}

/**
 * Forgets everything cached for the signed-in user: the cache in memory and the
 * saved copy on the device. Call it on sign-out, so nothing of yours is left for
 * whoever uses the phone next, not even offline.
 */
export async function forgetCachedData(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  // A save already scheduled by the clear may still land after this; it holds
  // an empty cache, so nothing of the user's survives either way.
  try {
    await persister.removeClient();
  } catch {
    // IndexedDB is broken, so it most likely never held a copy. Signing out on
    // the server already worked; don't make the button fail over this.
  }
}
