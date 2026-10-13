import { describe, expect, it } from 'vitest';
import { NetworkError, toApiError } from './api.ts';
import { shouldRetry } from './query-client.ts';

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
});
