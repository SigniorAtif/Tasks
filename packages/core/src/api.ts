// The HTTP contract between the API and its clients (D-041, D-043). The API
// sends these shapes and the PWA reads them, so both import them from here
// instead of keeping two copies that drift apart.
//
// Rules for changing this file inside /api/v1: only add things (new fields,
// new codes). Clients ignore fields they don't know and treat an unknown error
// code like `internal_error`.

import type { IanaZone, Instant, WallTime } from './types.ts';

/** URL paths that more than one package needs: the API, the PWA, the deploy smoke test. */
export const paths = {
  /** Public liveness and version check. */
  healthz: '/healthz',
  /** Better Auth's routes (sign-in, callback, sign-out) live under this prefix. */
  auth: '/api/auth',
  /** Everything else is versioned under this prefix and needs a session. */
  apiV1: '/api/v1',
  me: '/api/v1/me',
} as const;

/**
 * `GET /healthz`. Public, no session needed. Status 200 when the database
 * answers, 503 with the same body when it doesn't.
 */
export interface Healthz {
  /** The git commit the running server was built from. `dev` when run from source. */
  sha: string;
  /** Whether a `select 1` against Postgres succeeded just now. */
  dbOk: boolean;
  /** The server's clock when it answered. */
  time: Instant;
}

/** App settings for one user: the `profile` table, separate from the identity tables (D-058). */
export interface Profile {
  /** The zone "today" and the calendar are shown in. */
  tzid: IanaZone;
  /** When one day rolls over into the next, in `tzid` (D-035). */
  dayBoundary: WallTime;
}

/** What a new user's profile starts as. */
export const DEFAULT_PROFILE: Profile = { tzid: 'Asia/Kolkata', dayBoundary: '04:00' };

/** `GET /api/v1/me`. The signed-in user, their settings and the server's clock. */
export interface Me {
  user: {
    /** UUIDv7 (D-034). The future shared-identity `sub` (D-063). */
    id: string;
    email: string;
    name: string;
    image: string | null;
  };
  profile: Profile;
  /** The server's clock, so the PWA can show it in `profile.tzid`. */
  serverTime: Instant;
}

/** Stable, machine-readable error codes. Clients branch on these, never on `title` or `detail`. */
export type ErrorCode =
  /** No session, or it expired. HTTP 401. */
  | 'unauthenticated'
  /** Signed in, but not allowed (for example, an email outside the allowlist). HTTP 403. */
  | 'forbidden'
  /** No such route, or no such row for this user. HTTP 404. */
  | 'not_found'
  /** The body isn't valid JSON. HTTP 400. */
  | 'malformed_request'
  /** Valid JSON with the wrong shape or values; see `errors`. HTTP 422. */
  | 'validation_failed'
  /** A bug or an outage. The details are in the server log under `requestId`. HTTP 500. */
  | 'internal_error';

/**
 * The body of every error response, sent as `application/problem+json`
 * (RFC 9457, D-043).
 */
export interface Problem {
  /** Always `about:blank` for now: `code` carries the meaning. */
  type: string;
  /** A short, human summary of the code, such as "Not signed in". */
  title: string;
  /** The HTTP status, repeated in the body. */
  status: number;
  code: ErrorCode;
  /** What went wrong in this case, for people. Never secrets or stack traces. */
  detail?: string;
  /** Matches the `X-Request-Id` response header and the server log line. */
  requestId: string;
  /** One entry per invalid field, for `validation_failed` only. */
  errors?: { path: string; message: string }[];
}
