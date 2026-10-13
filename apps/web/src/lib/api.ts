// Talking to our own API. Every call uses a path with no host (`/api/v1/me`),
// so it goes to the origin the page came from: the session cookie rides along
// and there's no CORS. In development Vite forwards these paths to the API
// (vite.config.ts); in production the API serves the page itself.
//
// The response types come from @tasks/core, the contract both sides share.
// This file reads them as a "tolerant reader": it relies only on fields the
// contract promises and ignores anything extra, so the API can add fields
// without breaking an older PWA still installed on a phone.

import type { ErrorCode, Problem } from '@tasks/core';

/** One invalid field from a 422 `validation_failed` answer: `{ path: 'rule.byDay', message: '…' }`. */
export type FieldError = NonNullable<Problem['errors']>[number];

/** Every code in the contract. Anything else the server sends is treated as `internal_error`. */
const KNOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'malformed_request',
  'validation_failed',
  'internal_error',
]);

/** The server answered, but with an error status. Built from its `Problem` body when it sent one. */
export class ApiError extends Error {
  /** The HTTP status, such as 401. */
  readonly status: number;
  /** What went wrong, for code to branch on. Never branch on `message`. */
  readonly code: ErrorCode;
  /** The server's explanation of this particular case, for people. */
  readonly detail: string | undefined;
  /** Quote it in a bug report: it finds the matching line in the server's log. */
  readonly requestId: string | undefined;
  /** For `validation_failed`: which fields were wrong, so a form can mark each one. Else empty. */
  readonly errors: readonly FieldError[];

  constructor(init: {
    status: number;
    code: ErrorCode;
    title: string;
    detail?: string | undefined;
    requestId?: string | undefined;
    errors?: readonly FieldError[] | undefined;
  }) {
    super(init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.errors = init.errors ?? [];
  }
}

/** The request never got an answer: the phone is offline, or the server can't be reached. */
export class NetworkError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Couldn't reach the server", options);
    this.name = 'NetworkError';
  }
}

/** True when the error means "nobody is signed in": the caller should go to /login. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}

/**
 * The error code for a response. A code we know is used as is; a code we don't
 * know (added to the API after this PWA was built) counts as `internal_error`,
 * as the contract says. With no code at all (an HTML error page from a proxy,
 * say), the HTTP status decides.
 */
function errorCode(sentCode: unknown, status: number): ErrorCode {
  if (typeof sentCode === 'string') {
    return KNOWN_CODES.has(sentCode) ? (sentCode as ErrorCode) : 'internal_error';
  }
  switch (status) {
    case 400:
      return 'malformed_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation_failed';
    default:
      return 'internal_error';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The Problem's `errors`, keeping only well-formed entries. Anything else becomes `[]`. */
function fieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.path === 'string' && typeof entry.message === 'string'
      ? [{ path: entry.path, message: entry.message }]
      : [],
  );
}

/**
 * Turns an error response into an `ApiError`. `body` is the parsed JSON, or
 * `undefined` when the body wasn't JSON (an HTML error page from a proxy, say).
 * Missing or wrongly typed fields fall back to safe values instead of throwing.
 */
export function toApiError(
  status: number,
  body: unknown,
  requestIdHeader: string | null,
): ApiError {
  const problem = isRecord(body) ? body : {};
  return new ApiError({
    status,
    code: errorCode(problem.code, status),
    title: optionalString(problem.title) ?? `Request failed (HTTP ${status})`,
    detail: optionalString(problem.detail),
    requestId: optionalString(problem.requestId) ?? requestIdHeader ?? undefined,
    errors: fieldErrors(problem.errors),
  });
}

/** Parses the body as JSON if the server says it is JSON (`application/json`, `application/problem+json`). */
async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('Content-Type') ?? '';
  if (!type.includes('json')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export interface GetOptions {
  /** Lets TanStack Query cancel the request when nobody needs the answer any more. */
  signal?: AbortSignal | undefined;
  /**
   * Error statuses whose body is still the normal shape, so they count as data.
   * `/healthz` answers 503 with a `Healthz` body when the database is down.
   */
  okStatuses?: readonly number[];
}

/**
 * Sends one request to our API. "No answer at all" becomes a `NetworkError`;
 * any answer, even an error status, is returned for the caller to read.
 */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      // Send the session cookie. `same-origin` is fetch's default; it's spelled
      // out because the whole login depends on it. Never `include`: we never
      // call another origin.
      credentials: 'same-origin',
    });
  } catch (error) {
    // A cancelled request isn't a network problem; let the caller see the abort.
    if (init.signal?.aborted) throw error;
    throw new NetworkError({ cause: error });
  }
}

/**
 * A success that isn't JSON usually means the request missed the API and got
 * the web page instead (a proxy or route that isn't set up).
 */
function notJson(path: string, response: Response, requestId: string | null): ApiError {
  return new ApiError({
    status: response.status,
    code: 'internal_error',
    title: `Expected JSON from ${path}, got ${response.headers.get('Content-Type') ?? 'no content type'}`,
    requestId: requestId ?? undefined,
  });
}

/**
 * `GET`s one of our API paths and returns its JSON body as `T`.
 * Throws `ApiError` for an error status and `NetworkError` when there's no answer.
 */
export async function apiGet<T>(path: string, options: GetOptions = {}): Promise<T> {
  const response = await send(path, {
    headers: { Accept: 'application/json' },
    signal: options.signal ?? null,
  });

  const body = await readJson(response);
  const requestId = response.headers.get('X-Request-Id');
  const isOk = response.ok || (options.okStatuses ?? []).includes(response.status);

  if (!isOk) throw toApiError(response.status, body, requestId);
  if (body === undefined) throw notJson(path, response, requestId);
  return body as T;
}

/**
 * Sends a change to one of our API paths: `POST` creates, `PATCH` changes some
 * fields, `DELETE` removes. `body` goes as JSON. Returns the answer's JSON body
 * as `T`, or `undefined` for `204 No Content` (what `DELETE` answers).
 *
 * Throws like `apiGet`: `NetworkError` when there's no answer, `ApiError` for an
 * error status. A 422's `errors` stay on the `ApiError`, so a form can put each
 * message next to its field.
 */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await send(path, {
    method,
    // Only say the body is JSON when there is one: a plain DELETE has none.
    headers:
      body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });

  const answer = await readJson(response);
  const requestId = response.headers.get('X-Request-Id');

  if (!response.ok) throw toApiError(response.status, answer, requestId);
  // Nothing to read: the caller asked for `undefined` (`apiSend<undefined>`).
  if (response.status === 204) return undefined as T;
  if (answer === undefined) throw notJson(path, response, requestId);
  return answer as T;
}

/** A short, human description of any error, for the error and offline screens. */
export function describeError(error: unknown): { title: string; message: string; small?: string } {
  if (error instanceof NetworkError) {
    return {
      title: "You're offline",
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  }
  if (error instanceof ApiError) {
    const parts = [`Error code: ${error.code}`];
    if (error.requestId !== undefined) parts.push(`request ${error.requestId}`);
    // 502/503/504 usually come from whatever sits in front of the API (Caddy in
    // production, Vite in development) when the API itself isn't answering.
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return {
        title: 'The server is not answering',
        message: 'It may be restarting. Try again in a minute.',
        small: [...parts, `HTTP ${error.status}`].join(' · '),
      };
    }
    return {
      title: 'Something went wrong',
      message: error.detail ?? error.message,
      small: parts.join(' · '),
    };
  }
  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : String(error),
  };
}
