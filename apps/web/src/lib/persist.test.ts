import { dehydrate, QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { describe, expect, it } from 'vitest';
import { NetworkError } from './api.ts';
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE_MS,
  createPersister,
  dehydrateOptions,
  type KeyValueStore,
  lastGoodAnswers,
  shouldPersistQuery,
  toAsyncStorage,
} from './persist.ts';

/** A stand-in for IndexedDB: a Map behind the same three async functions. */
function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    del: async (key) => {
      map.delete(key);
    },
  };
}

const NOW = Date.parse('2026-10-13T08:32:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A real cached query, so the filter sees exactly what TanStack Query hands it. */
function cachedQuery(queryKey: unknown[], updatedAt = NOW) {
  const client = new QueryClient();
  client.setQueryData(queryKey, { any: 'data' }, { updatedAt });
  const query = client.getQueryCache().find({ queryKey });
  if (query === undefined) throw new Error('query not cached');
  return query;
}

/** `me` as it is after a refetch failed offline: status `error`, last answer kept. */
function failedRefetch(client = new QueryClient()) {
  client.setQueryData(['me'], { user: { name: 'Alice' } }, { updatedAt: NOW });
  const query = client.getQueryCache().find({ queryKey: ['me'] });
  if (query === undefined) throw new Error('query not cached');
  query.setState({ status: 'error', error: new NetworkError(), errorUpdatedAt: NOW + DAY });
  return query;
}

describe('shouldPersistQuery', () => {
  it('keeps the user, groups, series and every calendar window', () => {
    for (const key of [['me'], ['groups'], ['series'], ['calendar', '2026-10-12', '2026-10-18']]) {
      expect(shouldPersistQuery(cachedQuery(key), NOW)).toBe(true);
    }
  });

  it('never keeps healthz or keys it does not know', () => {
    expect(shouldPersistQuery(cachedQuery(['healthz']), NOW)).toBe(false);
    expect(shouldPersistQuery(cachedQuery(['tasks']), NOW)).toBe(false);
  });

  it('keeps nothing for a query that never had an answer', () => {
    const client = new QueryClient();
    const query = client.getQueryCache().build(client, { queryKey: ['me'] });
    expect(query.state.status).toBe('pending');
    expect(shouldPersistQuery(query, NOW)).toBe(false);
  });

  it('keeps the answer of a query whose latest refetch failed offline', () => {
    expect(shouldPersistQuery(failedRefetch(), NOW)).toBe(true);
  });

  it('drops answers older than the 30-day limit', () => {
    expect(shouldPersistQuery(cachedQuery(['me'], NOW - 29 * DAY), NOW)).toBe(true);
    expect(shouldPersistQuery(cachedQuery(['me'], NOW - CACHE_MAX_AGE_MS - 1), NOW)).toBe(false);
  });
});

describe('toAsyncStorage', () => {
  it('maps getItem, setItem and removeItem onto get, set and del', async () => {
    const store = memoryStore();
    const storage = toAsyncStorage(store);
    await storage.setItem('k', 'v');
    expect(store.map.get('k')).toBe('v');
    expect(await storage.getItem('k')).toBe('v');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeUndefined();
  });

  it('round-trips a cache through the persister: saved, then restored into a new client', async () => {
    const store = memoryStore();
    const persister = createPersister(store, 0);
    const before = new QueryClient();
    before.setQueryData(['me'], { user: { name: 'Alice' } });
    before.setQueryData(['healthz'], { sha: 'dev' });
    await persistQueryClientSave({
      queryClient: before,
      persister,
      buster: CACHE_BUSTER,
      dehydrateOptions,
    });

    const after = new QueryClient();
    await persistQueryClientRestore({ queryClient: after, persister, buster: CACHE_BUSTER });
    expect(after.getQueryData(['me'])).toEqual({ user: { name: 'Alice' } });
    expect(after.getQueryData(['healthz'])).toBeUndefined();

    // A copy saved by another version of the app is thrown away, not restored.
    const newer = new QueryClient();
    await persistQueryClientRestore({ queryClient: newer, persister, buster: 'v9.9.9' });
    expect(newer.getQueryData(['me'])).toBeUndefined();
    expect(store.map.size).toBe(0);
  });
});

describe('lastGoodAnswers', () => {
  it('saves a query whose refetch failed as a plain success with its answer', async () => {
    const persister = createPersister(memoryStore(), 0);
    const before = new QueryClient();
    failedRefetch(before);
    await persistQueryClientSave({
      queryClient: before,
      persister,
      buster: CACHE_BUSTER,
      dehydrateOptions,
    });

    // The next (offline) open finds the user, as a success, with no error attached.
    const after = new QueryClient();
    await persistQueryClientRestore({ queryClient: after, persister, buster: CACHE_BUSTER });
    expect(after.getQueryData(['me'])).toEqual({ user: { name: 'Alice' } });
    expect(after.getQueryState(['me'])).toMatchObject({
      status: 'success',
      error: null,
      dataUpdatedAt: NOW,
    });
  });

  it('leaves successful queries as they are', () => {
    const client = new QueryClient();
    client.setQueryData(['me'], { user: { name: 'Alice' } }, { updatedAt: NOW });
    const saved = {
      timestamp: NOW,
      buster: CACHE_BUSTER,
      clientState: dehydrate(client),
    };
    expect(lastGoodAnswers(saved)).toEqual(saved);
  });
});
