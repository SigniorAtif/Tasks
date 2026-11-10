// The HTTP contract between the API and its clients (D-041, D-043). The API
// sends these shapes and the PWA reads them, so both import them from here
// instead of keeping two copies that drift apart.
//
// Rules for changing this file inside /api/v1: only add things (new fields,
// new codes). Clients ignore fields they don't know and treat an unknown error
// code like `internal_error`.
// One exception so far: ADR v0.3 removed the group's `activeFrom`, `activeTo` and
// `archivedAt`, while the only client was our PWA, served from the same image.

import type {
  IanaZone,
  Instant,
  ISODate,
  Occurrence,
  ScheduleGroup,
  Series,
  WallTime,
} from './types.ts';

/** URL paths that more than one package needs: the API, the PWA, the deploy smoke test. */
export const paths = {
  /** Public liveness and version check. */
  healthz: '/healthz',
  /** Better Auth's routes (sign-in, callback, sign-out) live under this prefix. */
  auth: '/api/auth',
  /** Everything else is versioned under this prefix and needs a session. */
  apiV1: '/api/v1',
  me: '/api/v1/me',
  /**
   * `GET` lists, `POST` creates; `/api/v1/groups/:id` for `GET`, `PATCH`, `DELETE`;
   * `GET /api/v1/groups/:id/impact` for what a new last day would hide (`Impact`).
   */
  groups: '/api/v1/groups',
  /** Same shape as `groups`. */
  series: '/api/v1/series',
  /** `GET ?from=YYYY-MM-DD&to=YYYY-MM-DD`: the expanded occurrences (B6). */
  calendar: '/api/v1/calendar',
  /**
   * `PATCH /api/v1/occurrences/:seriesId/:originalDate` cancels, restores or changes the
   * reason of one occurrence, and answers with the `Occurrence` as it is now.
   */
  occurrences: '/api/v1/occurrences',
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
  /** When one day rolls over into the next, in `tzid` (D-035): midnight unless set later. */
  dayBoundary: WallTime;
}

/** What a new user's profile starts as. */
export const DEFAULT_PROFILE: Profile = { tzid: 'Asia/Kolkata', dayBoundary: '00:00' };

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

// ---------------------------------------------------------------------------
// The calendar routes (v0.2). Request bodies are the zod schemas in schemas.ts.
//
// - `POST` creates and answers 201 with the new row. Sending the same `id` again
//   answers 200 with the row as it is now and changes nothing (D-042).
// - `GET`/`PATCH` on `/:id` answer with the row; `DELETE` answers 204 with no body.
//   Deleting a group deletes its series and their overrides too.
// - A row that doesn't exist and a row that belongs to someone else look the same:
//   404 `not_found`. Nobody can learn which ids other people use.
// ---------------------------------------------------------------------------

/** `GET /api/v1/groups`: every group, archived ones too, sorted by name. */
export interface GroupList {
  groups: ScheduleGroup[];
}

/** `GET /api/v1/series`: every series in every group, by title. */
export interface SeriesList {
  series: Series[];
}

/**
 * `GET /api/v1/calendar?from&to`: what the engine computed for that window, sorted by
 * start (B6). At most 62 days, both ends included (B7); wider is a 422 on `to`.
 */
export interface CalendarResponse {
  from: ISODate;
  to: ISODate;
  occurrences: Occurrence[];
}

/**
 * `GET /api/v1/groups/:id/impact` and `/api/v1/series/:id/impact`, with an optional
 * `?lastDay=YYYY-MM-DD`: what giving the group or series that last day would hide.
 * The server works it out because the phone holds only the weeks it has loaded.
 */
export interface Impact {
  /**
   * How many changes (cancels, and later notes, moves and extras) show now and wouldn't
   * with `lastDay`: "3 changes after 27 Nov will stop showing". 0 without a `lastDay`.
   * Hidden, never erased: they come back when the last day moves later.
   */
  changesAfter: number;
  /**
   * Whether deleting it would lose anything: an occurrence before today (the user's
   * day), or any override. Delete asks for the name when it's true, and a plain
   * confirm is enough when it's false. The same whatever the query asks.
   */
  hasHistory: boolean;
}

/**
 * A series' answer, which can also weigh a new first day (`?firstDay=`) and a new
 * timing (`?byDay=&interval=`). Each change is counted once, by the date it shows
 * on, so the form can word each warning.
 */
export interface SeriesImpact extends Impact {
  /** Before a later `firstDay`: "1 change before 1 Oct will stop showing". 0 without one. */
  changesBefore: number;
  /**
   * Between the two, on a day the class no longer meets: one the new timing doesn't
   * produce, or, every 2 or more weeks, one a new first day moves it off (its weeks
   * count from the first day's week). 0 without either. From v0.3b a new timing
   * applies from a chosen day (ADR v0.3b), and this counts only the changes from then on.
   */
  changesOffTiming: number;
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
  /** The client-generated id is already used by a row this user can't see. HTTP 409. */
  | 'conflict'
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
