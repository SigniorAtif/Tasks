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
//
// A second copy, under its own key, holds the queue of occurrence changes made
// offline (occurrence-queue.ts), so a cancel survives the app being closed.

import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query, QueryClient } from '@tanstack/react-query';
import {
  type AsyncStorage,
  type PersistedClient,
  persistQueryClient,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import { isQueuedChange } from './occurrence-queue.ts';

/**
 * Change this when the shape of cached data changes (a renamed field in `Me`, say).
 * A copy saved under another buster is thrown away instead of being restored, so
 * a new version of the app never reads old shapes it doesn't understand.
 *
 * It only covers the saved reads. Queued changes are things the user did that
 * the server hasn't heard yet, so a bump must never throw them away (spec #6,
 * edge case 8): they're saved under their own key and `QUEUE_FORMAT`, which a
 * bump here doesn't touch.
 */
// v0.3.0: a group lost `activeFrom`, `activeTo` and `archivedAt` and gained `untilDate`.
export const CACHE_BUSTER = 'v0.3.0';

/**
 * The saved queue's own buster. Never change it to start clean: that would
 * lose changes the user made. If a queued change's shape ever has to change,
 * convert the old ones as they're read back instead.
 */
export const QUEUE_FORMAT = 'v1';

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

/** The IndexedDB keys: the saved reads, and the queue of occurrence changes. */
const STORAGE_KEY = 'tasks-query-cache';
const QUEUE_KEY = 'tasks-queued-changes';

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

/** What goes into the saved reads: the queries above, and no mutation. */
export const dehydrateOptions = {
  shouldDehydrateQuery: (query: Query) => shouldPersistQuery(query),
  shouldDehydrateMutation: () => false,
};

/**
 * What goes into the saved queue: occurrence changes the server hasn't
 * confirmed, paused or mid-request. Every other write is online-only (D-048),
 * so it never waits and is never saved.
 */
export const queueDehydrateOptions = {
  shouldDehydrateQuery: () => false,
  shouldDehydrateMutation: isQueuedChange,
};

/**
 * Saves every queued change as paused. Whatever it was doing (waiting offline,
 * mid-request, between retries), after a reload it has to be sent again, and
 * only paused changes are picked up by `resumePausedMutations`. One left
 * "pending but not paused" would never run, and would hold up every change
 * behind it in the queue. Its last failure goes too: an error doesn't survive
 * JSON, and it belongs to that moment.
 */
export function savedAsPaused(client: PersistedClient): PersistedClient {
  const mutations = client.clientState.mutations.map((mutation) => ({
    ...mutation,
    state: { ...mutation.state, isPaused: true, failureReason: null },
  }));
  return { ...client, clientState: { ...client.clientState, mutations } };
}

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
 * The persister for the reads: saves them as one JSON string under one key.
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

/**
 * Both saved copies, as the options `persistQueryClient` and its friends take:
 * the reads, under `cacheBuster` and kept 30 days, and the queue, under its own
 * format and kept until it's sent, however long that takes.
 */
export function savedCopies(
  store: KeyValueStore,
  { cacheBuster = CACHE_BUSTER, throttleTime = 1_000 } = {},
) {
  return [
    {
      persister: createPersister(store, throttleTime),
      buster: cacheBuster,
      maxAge: CACHE_MAX_AGE_MS,
      dehydrateOptions,
    },
    {
      persister: createAsyncStoragePersister({
        storage: toAsyncStorage(store),
        key: QUEUE_KEY,
        throttleTime,
        serialize: (client) => JSON.stringify(savedAsPaused(client)),
      }),
      buster: QUEUE_FORMAT,
      maxAge: Number.POSITIVE_INFINITY,
      dehydrateOptions: queueDehydrateOptions,
    },
  ];
}

/** `idb-keyval`'s default database (`keyval-store`), opened the first time it's used. */
const deviceStore: KeyValueStore = { get, set, del };
const copies = savedCopies(deviceStore);

/** Stop the saving `restoreQueryCache` started. Emptied by `handOverSavedCopies`. */
const stopSaving: Array<() => void> = [];

/**
 * Puts both saved copies back into `queryClient`, then keeps saving them after
 * every change. Resolves when they're back, or after `timeoutMs` if IndexedDB
 * is slow or broken; never rejects, so `main.tsx` can always go on to draw the app.
 *
 * On a timeout the restore carries on in the background. If it finishes later,
 * an older saved answer never replaces a newer one already fetched.
 */
export async function restoreQueryCache(
  queryClient: QueryClient,
  timeoutMs: number = RESTORE_TIMEOUT_MS,
): Promise<void> {
  // A failed restore has already deleted the broken copy; start without it.
  const restored = Promise.all(
    copies.map((copy) => {
      const [stop, restoring] = persistQueryClient({ queryClient, ...copy });
      stopSaving.push(stop);
      return restoring.catch(() => undefined);
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([restored, timeout]);
  clearTimeout(timer);
}

/** Stops writing the saved copies: another tab owns them now (one-tab.ts). */
export function stopSavingCopies(): void {
  for (const stop of stopSaving.splice(0)) stop();
}

/**
 * For handing the app to another tab (one-tab.ts): stops saving, then writes
 * both copies once more. Written at once, not up to a second later as usual
 * (`throttleTime`), so the other tab reads exactly what this one had, and this
 * tab never writes over what the other saves next.
 */
export async function handOverSavedCopies(
  queryClient: QueryClient,
  store: KeyValueStore = deviceStore,
): Promise<void> {
  stopSavingCopies();
  await Promise.all(
    savedCopies(store, { throttleTime: 0 }).map((copy) =>
      persistQueryClientSave({ queryClient, ...copy }),
    ),
  );
}

/**
 * Forgets everything cached for the signed-in user: the cache in memory, its
 * queued changes, and both saved copies on the device. Call it on sign-out, so
 * nothing of yours is left for whoever uses the phone next, not even offline.
 */
export async function forgetCachedData(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  // A save already scheduled by the clear may still land after this; it holds
  // an empty cache, so nothing of the user's survives either way.
  await Promise.all(
    copies.map(async (copy) => {
      try {
        await copy.persister.removeClient();
      } catch {
        // IndexedDB is broken, so it most likely never held a copy. Signing out
        // on the server already worked; don't make the button fail over this.
      }
    }),
  );
}
