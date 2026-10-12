import type { Problem } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp } from '../test/app.ts';
import { captureLogs } from '../test/logs.ts';
import { AppError } from './errors.ts';
import { jsonBody } from './json-body.ts';

function buildApp() {
  const { app, logs } = createTestApp();

  // Routes that exist only in this test, to trigger each kind of failure.
  app.get('/test/boom', () => {
    throw new Error('database password is hunter2');
  });
  app.get('/test/forbidden', () => {
    throw new AppError('forbidden', { detail: 'Not your calendar.' });
  });
  app.post('/test/echo', async (c) => {
    const body = await jsonBody(c, z.object({ title: z.string().min(1), minutes: z.number() }));
    return c.json(body);
  });
  return { app, logs };
}

async function problemOf(response: Response): Promise<Problem> {
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  const body = (await response.json()) as Problem;
  expect(body.type).toBe('about:blank');
  expect(body.status).toBe(response.status);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  return body;
}

describe('problem responses', () => {
  it('turns an unknown route into a 404 problem with a request id', async () => {
    const { app } = buildApp();
    const response = await app.request('/nope');
    expect(response.status).toBe(404);
    const problem = await problemOf(response);
    expect(problem).toMatchObject({ code: 'not_found', title: 'Not found' });
    expect(problem.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('passes an AppError through with its code and detail', async () => {
    const { app } = buildApp();
    const response = await app.request('/test/forbidden');
    expect(response.status).toBe(403);
    expect(await problemOf(response)).toMatchObject({
      code: 'forbidden',
      detail: 'Not your calendar.',
    });
  });

  it('hides an unexpected error from the client but logs its stack under the request id', async () => {
    const { app, logs } = buildApp();
    const response = await app.request('/test/boom');
    expect(response.status).toBe(500);
    const problem = await problemOf(response);
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Something went wrong',
      status: 500,
      code: 'internal_error',
      requestId: problem.requestId,
    });
    expect(JSON.stringify(problem)).not.toContain('hunter2');

    const logged = logs.lines.find((line) => line.msg === 'unhandled error');
    expect(logged).toMatchObject({ requestId: problem.requestId });
    expect(JSON.stringify(logged)).toContain('hunter2'); // the stack is for us, in the log
  });

  it('answers malformed JSON with 400 malformed_request', async () => {
    const { app } = buildApp();
    const response = await app.request('/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title": ',
    });
    expect(response.status).toBe(400);
    expect(await problemOf(response)).toMatchObject({ code: 'malformed_request' });
  });

  it('answers the wrong shape with 422 validation_failed and one entry per field', async () => {
    const { app } = buildApp();
    const response = await app.request('/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', minutes: 'sixty' }),
    });
    expect(response.status).toBe(422);
    const problem = await problemOf(response);
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors?.map((error) => error.path)).toEqual(['title', 'minutes']);
  });

  it('accepts a valid body', async () => {
    const { app } = buildApp();
    const response = await app.request('/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'DBMS', minutes: 60 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: 'DBMS', minutes: 60 });
  });

  it('refuses a body over 256 KB with 413 before reading it', async () => {
    const { app } = buildApp();
    const response = await app.request('/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(300 * 1024) },
      body: 'x'.repeat(300 * 1024),
    });
    expect(response.status).toBe(413);
    expect(await problemOf(response)).toMatchObject({ code: 'malformed_request' });
  });
});

describe('request ids and logging', () => {
  it('reuses a plain incoming X-Request-Id and replaces an unsafe one', async () => {
    const { app } = buildApp();
    const kept = await app.request('/nope', { headers: { 'x-request-id': 'abc-123' } });
    expect(kept.headers.get('x-request-id')).toBe('abc-123');

    const replaced = await app.request('/nope', { headers: { 'x-request-id': 'a b"c' } });
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes one access-log line per request, without the query string or cookies', async () => {
    const { app, logs } = buildApp();
    const response = await app.request('/nope?code=one-time-secret', {
      headers: { cookie: 'better-auth.session_token=cookie-secret' },
    });
    const accessLines = logs.lines.filter((line) => line.msg === 'request');
    expect(accessLines).toHaveLength(1);
    expect(accessLines[0]).toMatchObject({
      method: 'GET',
      path: '/nope',
      status: 404,
      requestId: response.headers.get('x-request-id'),
    });
    expect(accessLines[0]?.durationMs).toEqual(expect.any(Number));
    expect(logs.text()).not.toContain('one-time-secret');
    expect(logs.text()).not.toContain('cookie-secret');
  });

  it('redacts secrets even when a whole object is logged by mistake', () => {
    const { logger, text } = captureLogs();
    logger.info(
      {
        headers: { cookie: 'c-secret', authorization: 'Bearer a-secret' },
        env: { BETTER_AUTH_SECRET: 's-secret' },
      },
      'oops',
    );
    expect(text()).not.toMatch(/c-secret|a-secret|s-secret/);
    expect(text()).toContain('[redacted]');
  });

  it('adds the standard security headers', async () => {
    const { app } = buildApp();
    const response = await app.request('/nope');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
