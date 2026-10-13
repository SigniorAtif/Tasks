import { describe, expect, it } from 'vitest';
import { NetworkError, toApiError } from './api.ts';
import { type CachedQuery, formatSyncedAt, syncBadgeText, syncStatus } from './sync-status.ts';

// 08:32 UTC is 2:02 PM in Asia/Kolkata (UTC+5:30).
const T = Date.parse('2026-10-13T08:32:00Z');
const MIN = 60_000;

const ok = (key: string, at: number): CachedQuery => ({
  queryKey: [key],
  state: {
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: at,
    errorUpdatedAt: 0,
    error: null,
    fetchFailureReason: null,
  },
});

/** A query whose last fetch failed at `at`, still holding data from `dataAt`. */
const failed = (key: string, error: Error, at: number, dataAt = 0): CachedQuery => ({
  queryKey: [key],
  state: {
    status: 'error',
    fetchStatus: 'idle',
    dataUpdatedAt: dataAt,
    errorUpdatedAt: at,
    error,
    fetchFailureReason: error,
  },
});

describe('syncStatus', () => {
  it('is synced when online and the newest fetch worked', () => {
    expect(syncStatus([ok('me', T), ok('calendar', T - MIN)], true)).toEqual({
      state: 'synced',
      lastSyncedAt: T,
    });
  });

  it('is offline whenever the browser says so', () => {
    expect(syncStatus([ok('me', T)], false).state).toBe('offline');
  });

  it('is offline when the newest fetch got no answer, even if the browser says online', () => {
    const queries = [ok('calendar', T), failed('me', new NetworkError(), T + MIN, T - MIN)];
    expect(syncStatus(queries, true)).toEqual({ state: 'offline', lastSyncedAt: T });
  });

  it('is synced again once a newer fetch has worked', () => {
    const queries = [failed('calendar', new NetworkError(), T), ok('me', T + MIN)];
    expect(syncStatus(queries, true).state).toBe('synced');
  });

  it('is offline while a fetch is between retries after a failed try', () => {
    const retrying: CachedQuery = {
      queryKey: ['me'],
      state: {
        ...ok('me', T).state,
        fetchStatus: 'fetching',
        fetchFailureReason: new NetworkError(),
      },
    };
    expect(syncStatus([ok('calendar', T + MIN), retrying], true).state).toBe('offline');
  });

  it('is failing, not offline, when the server answered with an error', () => {
    const queries = [ok('me', T), failed('calendar', toApiError(503, undefined, null), T + MIN)];
    expect(syncStatus(queries, true).state).toBe('failing');
  });

  it('only looks at the calendar and the user', () => {
    const queries = [ok('me', T), failed('healthz', new NetworkError(), T + MIN)];
    expect(syncStatus([...queries, ok('groups', T + 2 * MIN)], true)).toEqual({
      state: 'synced',
      lastSyncedAt: T,
    });
  });

  it('has no last sync when nothing was ever fetched', () => {
    expect(syncStatus([], false)).toEqual({ state: 'offline', lastSyncedAt: null });
  });
});

describe('formatSyncedAt', () => {
  it('shows a 12-hour time in the given zone', () => {
    expect(formatSyncedAt(T, T, 'Asia/Kolkata')).toBe('2:02 PM');
    expect(formatSyncedAt(T, T, 'America/New_York')).toBe('4:32 AM');
  });

  it('writes midnight as 12, not 0', () => {
    expect(formatSyncedAt(Date.parse('2026-10-12T18:35:00Z'), T, 'Asia/Kolkata')).toBe('12:05 AM');
  });

  it('adds the date when it was not today in that zone', () => {
    const yesterday = T - 24 * 60 * MIN;
    expect(formatSyncedAt(yesterday, T, 'Asia/Kolkata')).toBe('12 Oct, 2:02 PM');
  });

  it('falls back to the phone zone for a zone it does not know, without throwing', () => {
    expect(formatSyncedAt(T, T, 'Mars/Olympus')).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
  });
});

describe('syncBadgeText', () => {
  it('says nothing when synced', () => {
    expect(syncBadgeText({ state: 'synced', lastSyncedAt: T }, T, 'Asia/Kolkata')).toBeNull();
  });

  it('says offline and when it last synced', () => {
    expect(syncBadgeText({ state: 'offline', lastSyncedAt: T }, T + MIN, 'Asia/Kolkata')).toBe(
      'offline · last synced 2:02 PM',
    );
  });

  it("says it can't sync when the server is failing", () => {
    expect(syncBadgeText({ state: 'failing', lastSyncedAt: T }, T, 'Asia/Kolkata')).toBe(
      "can't sync · last synced 2:02 PM",
    );
  });

  it('says only offline when nothing was ever synced', () => {
    expect(syncBadgeText({ state: 'offline', lastSyncedAt: null }, T)).toBe('offline');
  });
});
