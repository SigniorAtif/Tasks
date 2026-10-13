import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkError, toApiError } from './api.ts';
import { createQueryClient, shouldRetry } from './query-client.ts';

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('shouldRetry', () => {
  it('never retries a 4xx: asking again gets the same answer', () => {
    expect(shouldRetry(0, toApiError(401, undefined, null))).toBe(false);
    expect(shouldRetry(0, toApiError(404, undefined, null))).toBe(false);
  });

  it('retries network failures and 5xx twice, then gives up', () => {
    for (const error of [new NetworkError(), toApiError(503, undefined, null)]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(1, error)).toBe(true);
      expect(shouldRetry(2, error)).toBe(false);
    }
  });

  it('does not retry a network failure once the browser has said it is offline', () => {
    onlineManager.setOnline(false);
    expect(shouldRetry(0, new NetworkError())).toBe(false);
    // A 5xx did reach a server, so it is still worth another try.
    expect(shouldRetry(0, toApiError(503, undefined, null))).toBe(true);
  });
});

describe('createQueryClient', () => {
  it('keeps unused queries in memory at least as long as the saved copy lasts', () => {
    const client = createQueryClient();
    const queryKey = ['calendar', '2026-10-12', '2026-10-18'];
    client.setQueryData(queryKey, { occurrences: [] });
    const query = client.getQueryCache().find({ queryKey });
    expect(query?.gcTime).toBe(Number.POSITIVE_INFINITY);
  });
});
