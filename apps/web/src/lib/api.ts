// Talking to our own API. Every call uses a path with no host (`/api/v1/me`),
// so it goes to the origin the page came from: the session cookie rides along
// and there's no CORS. In development Vite forwards these paths to the API
// (vite.config.ts); in production the API serves the page itself.
//
// The response types come from @tasks/core, the contract both sides share.
// This file reads them as a "tolerant reader": it relies only on fields the
// contract promises and ignores anything extra, so the API can add fields
// without breaking an older PWA still installed on a phone.

import type { ErrorCode } from '@tasks/core';

/** Every code in the contract. Anything else the server sends is treated as `internal_error`. */
const KNOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'unauthenticated',
  'forbidden',
  'not_found',
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

  constructor(init: {
    status: number;
    code: ErrorCode;
    title: string;
    detail?: string | undefined;
    requestId?: string | undefined;
  }) {
    super(init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.requestId = init.requestId;
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
 * `GET`s one of our API paths and returns its JSON body as `T`.
 * Throws `ApiError` for an error status and `NetworkError` when there's no answer.
 */
export async function apiGet<T>(path: string, options: GetOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      // Send the session cookie. `same-origin` is fetch's default; it's spelled
      // out because the whole login depends on it. Never `include`: we never
      // call another origin.
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: options.signal ?? null,
    });
  } catch (error) {
    // A cancelled request isn't a network problem; let the caller see the abort.
    if (options.signal?.aborted) throw error;
    throw new NetworkError({ cause: error });
  }

  const body = await readJson(response);
  const requestId = response.headers.get('X-Request-Id');
  const isOk = response.ok || (options.okStatuses ?? []).includes(response.status);

  if (!isOk) throw toApiError(response.status, body, requestId);
  if (body === undefined) {
    // A 200 that isn't JSON usually means the request missed the API and got
    // the web page instead (a proxy or route that isn't set up).
    throw new ApiError({
      status: response.status,
      code: 'internal_error',
      title: `Expected JSON from ${path}, got ${response.headers.get('Content-Type') ?? 'no content type'}`,
      requestId: requestId ?? undefined,
    });
  }
  return body as T;
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
