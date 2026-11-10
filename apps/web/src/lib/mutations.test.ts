import { QueryClient } from '@tanstack/react-query';
import type { CalendarResponse } from '@tasks/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { occurrence } from '../calendar/model/test-builders.ts';
import { ApiError } from './api.ts';
import {
  changeOccurrence,
  deleteGroup,
  deleteSeries,
  invalidateAfterWrite,
  newId,
  putOccurrence,
  updateGroup,
  updateSeries,
} from './mutations.ts';

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

describe('updateGroup', () => {
  it('PATCHes only the fields it is given', async () => {
    const fetchMock = answerWith(200, { id: 'g', name: 'Pottery evenings' });
    await updateGroup({ id: 'g', changes: { name: 'Pottery evenings', untilDate: null } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/groups/g',
      expect.objectContaining({
        method: 'PATCH',
        body: '{"name":"Pottery evenings","untilDate":null}',
      }),
    );
  });
});

describe.each([
  ['deleteSeries', deleteSeries, '/api/v1/series/x'],
  ['deleteGroup', deleteGroup, '/api/v1/groups/x'],
])('%s', (_name, deleteRow, path) => {
  it('sends DELETE and accepts 204', async () => {
    const fetchMock = answerWith(204);
    await expect(deleteRow('x')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'DELETE' }));
  });

  it('counts a 404 as done: an earlier try already deleted it', async () => {
    answerWith(404, { code: 'not_found', title: 'Not found', status: 404, requestId: 'r' });
    await expect(deleteRow('x')).resolves.toBeUndefined();
  });

  it('still fails on any other error', async () => {
    answerWith(500, { code: 'internal_error', title: 'Oops', status: 500, requestId: 'r' });
    await expect(deleteRow('x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('changeOccurrence', () => {
  it('PATCHes the occurrence by its series and original date, and returns the answer', async () => {
    const answer = occurrence({ status: 'cancelled', cancelReason: 'skipped' });
    const fetchMock = vi.fn(async () => Response.json(answer));
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeOccurrence({
      seriesId: 's',
      originalDate: '2026-10-06',
      change: { status: 'cancelled', cancelReason: 'skipped' },
    });

    expect(result).toEqual(answer);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/occurrences/s/2026-10-06',
      expect.objectContaining({
        method: 'PATCH',
        body: '{"status":"cancelled","cancelReason":"skipped"}',
      }),
    );
  });
});

describe('putOccurrence', () => {
  const week = (from: string, to: string, occurrences = [occurrence()]): CalendarResponse => ({
    from,
    to,
    occurrences,
  });

  it("puts the server's answer into every cached window that shows it, without refetching", () => {
    const client = new QueryClient();
    const other = occurrence({ key: 's:2026-10-07', date: '2026-10-07' });
    client.setQueryData(
      ['calendar', '2026-10-05', '2026-10-11'],
      week('2026-10-05', '2026-10-11', [occurrence(), other]),
    );
    client.setQueryData(['calendar', '2026-10-01', '2026-10-31'], week('2026-10-01', '2026-10-31'));
    const elsewhere = week('2026-10-12', '2026-10-18', []);
    client.setQueryData(['calendar', '2026-10-12', '2026-10-18'], elsewhere);

    const cancelled = occurrence({ status: 'cancelled', cancelReason: 'not_held' });
    putOccurrence(client, cancelled);

    const shown = (from: string, to: string) =>
      client.getQueryData<CalendarResponse>(['calendar', from, to])?.occurrences;
    expect(shown('2026-10-05', '2026-10-11')).toEqual([cancelled, other]);
    expect(shown('2026-10-01', '2026-10-31')).toEqual([cancelled]);
    expect(client.getQueryData(['calendar', '2026-10-12', '2026-10-18'])).toBe(elsewhere);
    expect(client.getQueryState(['calendar', '2026-10-05', '2026-10-11'])?.isInvalidated).toBe(
      false,
    );
  });
});
