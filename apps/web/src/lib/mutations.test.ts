import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.ts';
import { deleteSeries, invalidateAfterWrite, newId, updateSeries } from './mutations.ts';

/** Makes every `fetch` call answer with a copy of this response. */
function answerWith(status: number, body?: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: body === undefined ? {} : { 'Content-Type': 'application/problem+json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('makes a different UUIDv7 every time', () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(a);
  });
});

describe('invalidateAfterWrite', () => {
  function cacheWithEverything() {
    const client = new QueryClient();
    for (const key of [['me'], ['groups'], ['series'], ['calendar', '2026-10-12', '2026-10-18']]) {
      client.setQueryData(key, {});
    }
    return client;
  }
  const invalidated = (client: QueryClient, key: string[]) =>
    client.getQueryState(key)?.isInvalidated;

  it('marks every calendar window and the series list out of date, not the user', async () => {
    const client = cacheWithEverything();
    await invalidateAfterWrite(client);
    expect(invalidated(client, ['calendar', '2026-10-12', '2026-10-18'])).toBe(true);
    expect(invalidated(client, ['series'])).toBe(true);
    expect(invalidated(client, ['groups'])).toBe(false);
    expect(invalidated(client, ['me'])).toBe(false);
  });

  it('also marks the groups when asked to', async () => {
    const client = cacheWithEverything();
    await invalidateAfterWrite(client, { groups: true });
    expect(invalidated(client, ['groups'])).toBe(true);
  });
});

describe('updateSeries', () => {
  it('PATCHes only the fields it is given', async () => {
    const fetchMock = answerWith(200, { id: 'x', title: 'DS' });
    await updateSeries({ id: 'x', changes: { title: 'DS' } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/series/x',
      expect.objectContaining({ method: 'PATCH', body: '{"title":"DS"}' }),
    );
  });
});

describe('deleteSeries', () => {
  it('sends DELETE and accepts 204', async () => {
    const fetchMock = answerWith(204);
    await expect(deleteSeries('x')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/series/x',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('counts a 404 as done: an earlier try already deleted it', async () => {
    answerWith(404, { code: 'not_found', title: 'Not found', status: 404, requestId: 'r' });
    await expect(deleteSeries('x')).resolves.toBeUndefined();
  });

  it('still fails on any other error', async () => {
    answerWith(500, { code: 'internal_error', title: 'Oops', status: 500, requestId: 'r' });
    await expect(deleteSeries('x')).rejects.toBeInstanceOf(ApiError);
  });
});
