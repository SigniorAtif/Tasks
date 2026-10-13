import type { Problem } from '@tasks/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiGet,
  describeError,
  isUnauthenticated,
  NetworkError,
  toApiError,
} from './api.ts';

const problem401: Problem = {
  type: 'about:blank',
  title: 'Not signed in',
  status: 401,
  code: 'unauthenticated',
  requestId: 'req-1',
};

/** Makes the next `fetch` call answer with this response (or fail with this error). */
function nextFetch(result: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function json(status: number, body: unknown, contentType = 'application/json', headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType, ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toApiError', () => {
  it('reads a well-formed Problem', () => {
    const error = toApiError(401, { ...problem401, detail: 'Session expired' }, null);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('unauthenticated');
    expect(error.message).toBe('Not signed in');
    expect(error.detail).toBe('Session expired');
    expect(error.requestId).toBe('req-1');
  });

  it('ignores fields it does not know (tolerant reader)', () => {
    const error = toApiError(
      403,
      { ...problem401, status: 403, code: 'forbidden', extra: 1 },
      null,
    );
    expect(error.code).toBe('forbidden');
    expect(Object.keys(error)).not.toContain('extra');
  });

  it('treats a code it does not know as internal_error, as the contract says', () => {
    expect(toApiError(429, { ...problem401, code: 'rate_limited' }, null).code).toBe(
      'internal_error',
    );
  });

  it('falls back to the HTTP status when there is no Problem body', () => {
    expect(toApiError(401, undefined, null).code).toBe('unauthenticated');
    expect(toApiError(404, undefined, null).code).toBe('not_found');
    expect(toApiError(502, undefined, null).code).toBe('internal_error');
    expect(toApiError(502, undefined, null).message).toBe('Request failed (HTTP 502)');
  });

  it('takes the request id from the header when the body lacks one', () => {
    expect(toApiError(500, undefined, 'req-9').requestId).toBe('req-9');
    expect(toApiError(500, { requestId: 'req-body' }, 'req-9').requestId).toBe('req-body');
  });

  it('survives wrongly typed fields', () => {
    const error = toApiError(500, { code: 42, title: null, detail: ['x'] }, null);
    expect(error.code).toBe('internal_error');
    expect(error.message).toBe('Request failed (HTTP 500)');
    expect(error.detail).toBeUndefined();
  });
});

describe('apiGet', () => {
  it('returns the JSON body and sends the session cookie', async () => {
    const fetchMock = nextFetch(json(200, { sha: 'abc', dbOk: true, time: 'x' }));
    await expect(apiGet('/healthz')).resolves.toEqual({ sha: 'abc', dbOk: true, time: 'x' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/healthz',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('throws an ApiError built from an application/problem+json body', async () => {
    nextFetch(json(401, problem401, 'application/problem+json'));
    const error = await apiGet('/api/v1/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(isUnauthenticated(error)).toBe(true);
  });

  it('reads the X-Request-Id header', async () => {
    nextFetch(new Response('Bad gateway', { status: 502, headers: { 'X-Request-Id': 'req-7' } }));
    const error = await apiGet('/api/v1/me').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'internal_error', requestId: 'req-7' });
  });

  it('accepts an error status listed in okStatuses as data', async () => {
    nextFetch(json(503, { sha: 'abc', dbOk: false, time: 'x' }));
    await expect(apiGet('/healthz', { okStatuses: [503] })).resolves.toMatchObject({ dbOk: false });
  });

  it('throws a NetworkError when fetch itself fails', async () => {
    nextFetch(new TypeError('Failed to fetch'));
    await expect(apiGet('/api/v1/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('lets an abort through instead of calling it a network problem', async () => {
    const controller = new AbortController();
    controller.abort();
    nextFetch(new DOMException('Aborted', 'AbortError'));
    await expect(apiGet('/api/v1/me', { signal: controller.signal })).rejects.toThrow('Aborted');
  });

  it('rejects a 200 that is not JSON (the request missed the API)', async () => {
    nextFetch(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(apiGet('/api/v1/me')).rejects.toThrow('Expected JSON from /api/v1/me');
  });
});

describe('describeError', () => {
  it('calls a network failure "offline"', () => {
    expect(describeError(new NetworkError()).title).toBe("You're offline");
  });

  it('shows the code and request id of an API error in small print', () => {
    const text = describeError(toApiError(500, { ...problem401, code: 'internal_error' }, null));
    expect(text.small).toBe('Error code: internal_error · request req-1');
  });

  it('says the server is not answering for a bare 502 from the proxy in front of it', () => {
    expect(describeError(toApiError(502, undefined, null))).toEqual({
      title: 'The server is not answering',
      message: 'It may be restarting. Try again in a minute.',
      small: 'Error code: internal_error · HTTP 502',
    });
  });

  it('copes with things that are not errors', () => {
    expect(describeError('boom').message).toBe('boom');
  });
});
