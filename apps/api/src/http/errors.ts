// One error shape for the whole API (D-043): RFC 9457 "problem details", sent
// as `application/problem+json`. Code anywhere throws an `AppError`; the
// handlers at the bottom of this file are the only place that turns errors
// into responses, so every failure looks the same to clients.

import type { ErrorCode, Problem } from '@tasks/core';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { AppEnv } from './context.ts';

/** The usual status and a short human title for each code. */
const CODES: Record<ErrorCode, { status: ContentfulStatusCode; title: string }> = {
  malformed_request: { status: 400, title: 'Malformed request' },
  unauthenticated: { status: 401, title: 'Not signed in' },
  forbidden: { status: 403, title: 'Not allowed' },
  not_found: { status: 404, title: 'Not found' },
  validation_failed: { status: 422, title: 'Validation failed' },
  internal_error: { status: 500, title: 'Something went wrong' },
};

/** An error we expect and want to show the client, e.g. "not signed in". */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly detail: string | undefined;
  readonly errors: Problem['errors'];

  constructor(
    code: ErrorCode,
    options: {
      detail?: string;
      /** Only when the HTTP status should differ from the code's usual one (e.g. 413). */
      status?: ContentfulStatusCode;
      errors?: Problem['errors'];
      cause?: unknown;
    } = {},
  ) {
    super(options.detail ?? CODES[code].title, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? CODES[code].status;
    this.detail = options.detail;
    this.errors = options.errors;
  }
}

/** A zod failure becomes a 422 with one entry per invalid field. */
export function validationFailed(error: ZodError): AppError {
  return new AppError('validation_failed', {
    detail: 'Some fields are missing or invalid.',
    errors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/** Errors Hono itself throws (body too large, CSRF check, …) carry only a status. */
function fromHttpException(error: HTTPException): AppError {
  const status = error.status as ContentfulStatusCode;
  if (status === 401) return new AppError('unauthenticated');
  if (status === 403) return new AppError('forbidden', { detail: error.message || undefined });
  if (status === 404) return new AppError('not_found');
  if (status === 413) {
    return new AppError('malformed_request', {
      status,
      detail: 'The request body is too large.',
    });
  }
  if (status >= 400 && status < 500) return new AppError('malformed_request', { status });
  return new AppError('internal_error', { status });
}

export function problemResponse(c: Context<AppEnv>, error: AppError): Response {
  const body: Problem = {
    type: 'about:blank',
    title: CODES[error.code].title,
    status: error.status,
    code: error.code,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    requestId: c.get('requestId'),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
  };
  return c.body(JSON.stringify(body), error.status, {
    'Content-Type': 'application/problem+json',
  });
}

/** `app.onError`: the single place an error becomes a response. */
export const onError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof AppError) return problemResponse(c, error);
  if (error instanceof HTTPException) return problemResponse(c, fromHttpException(error));
  if (error instanceof ZodError) return problemResponse(c, validationFailed(error));
  // Anything else is a bug or an outage. The stack goes to the log, under the
  // request id; the client gets the id and nothing about our internals.
  c.get('log').error({ err: error }, 'unhandled error');
  return problemResponse(c, new AppError('internal_error'));
};

/** `app.notFound`: no route matched. */
export const onNotFound: NotFoundHandler<AppEnv> = (c) =>
  problemResponse(
    c,
    new AppError('not_found', { detail: `No route for ${c.req.method} ${c.req.path}.` }),
  );
