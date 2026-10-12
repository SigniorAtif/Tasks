// The single source of names (D-015). Every package imports these instead of
// inventing its own spelling. A new name goes here first.
//
// These are plain data shapes: what the database stores and what the API sends.
// Dates and times are strings so the shapes survive JSON unchanged; the engine
// parses them into Temporal objects internally.

// ---------------------------------------------------------------------------
// Time (D-025, D-035)
// ---------------------------------------------------------------------------

/** A local calendar date, `YYYY-MM-DD`. No time, no zone. */
export type ISODate = string;

/** A local wall-clock time, `HH:MM` (Postgres may return `HH:MM:SS`). No date, no zone. */
export type WallTime = string;

/** An IANA time-zone name such as `Asia/Kolkata`. Never `IST` and never `+05:30`. */
export type IanaZone = string;

/** One moment in time, RFC 3339. Accepted with any offset; always sent back in UTC (`...Z`). */
export type Instant = string;

/** An inclusive range of local dates: both `from` and `to` are part of the window. */
export interface DateWindow {
  from: ISODate;
  to: ISODate;
}

// ---------------------------------------------------------------------------
// Recurrence rules (D-024)
// ---------------------------------------------------------------------------

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/**
 * A strict subset of RFC 5545 RRULE, as JSON. `interval` is "every N days" or
 * "every N weeks". Weeks start on Monday for the phase of `interval > 1` rules.
 * There is no COUNT: it is converted to `Series.untilDate` when saving.
 */
export type Rule =
  | { freq: 'daily'; interval: number }
  | { freq: 'weekly'; interval: number; byDay: Weekday[] };

// ---------------------------------------------------------------------------
// Calendar: groups, series, overrides, day exceptions (D-004, D-021, D-026)
// ---------------------------------------------------------------------------

/** Stored meaning of a cancellation. UI labels: "Prof cancelled" / "I skipped" (D-027). */
export type CancelReason = 'not_held' | 'skipped';

/** Who cancelled: the user on this one occurrence, or a day exception (holiday, day off). */
export type CancelOrigin = 'user' | 'holiday';

/** "Classes · Sem 3", "Health". Owns series and decides when they are active. */
export interface ScheduleGroup {
  id: string;
  name: string;
  colorToken: string;
  /** First active day, inclusive. Nothing in the group occurs before it. */
  activeFrom: ISODate;
  /** Last active day, inclusive. `null` = open-ended. Archiving sets it (D-030). */
  activeTo: ISODate | null;
  /** Whether day exceptions (holidays, days off) cancel this group's occurrences. */
  observesHolidays: boolean;
  attendance: boolean;
  attendanceThresholdPct: number;
  attendanceTrackingFrom: ISODate | null;
  archivedAt: Instant | null;
}

/** One timing pattern: "DBMS, Mon and Wed at 10:00 for 60 minutes in Asia/Kolkata". */
export interface Series {
  id: string;
  groupId: string;
  title: string;
  /** Attendance is counted per subject (D-032). Defaults to the title. */
  subject: string;
  location: string | null;
  rule: Rule;
  /** First eligible day, and the anchor for "every N weeks/days". */
  startDate: ISODate;
  /** Last eligible day, inclusive. `null` = until the group ends. */
  untilDate: ISODate | null;
  startTime: WallTime;
  durationMin: number;
  tzid: IanaZone;
  /** Set on the newer half of a split (D-023). */
  previousSeriesId: string | null;
}

/**
 * Fields an override can set on one occurrence. `null` means "inherit from the
 * series" (patch semantics), so a later change to the series still flows through
 * to fields the override didn't touch. `note` is the exception: the series has
 * no note, so `null` there just means "no note".
 */
interface OverrideFields {
  id: string;
  seriesId: string;
  /** `null` = inherit (scheduled, unless a day exception cancels it). */
  status: 'scheduled' | 'cancelled' | null;
  /** Only meaningful when `status` is `cancelled`. `null` in groups without attendance. */
  cancelReason: CancelReason | null;
  durationMin: number | null;
  /** Attendance confirmation (v2, D-032). */
  confirmedAt: Instant | null;
  /**
   * Free text on this one occurrence: "Bring the lab manual". The series has no note to
   * inherit, so `null` simply means "no note". It never changes when or whether the
   * occurrence happens: a note-only override still lets a holiday cancel the class.
   */
  note: string | null;
}

/** Something the user said about one generated occurrence. Unique per (seriesId, originalDate). */
export interface ModifiedOverride extends OverrideFields {
  kind: 'modified';
  /** The date the rule generated. This is the occurrence's identity (D-022). */
  originalDate: ISODate;
  /** Move to another day. */
  newDate: ISODate | null;
  /** Move to another time. */
  newStartTime: WallTime | null;
}

/** A one-off occurrence the rule never generated, such as a make-up class (D-031). */
export interface ExtraOverride extends OverrideFields {
  kind: 'extra';
  originalDate: null;
  newDate: ISODate;
  newStartTime: WallTime;
}

export type OccurrenceOverride = ModifiedOverride | ExtraOverride;

/** A holiday or a personal day off. One row per day, applied to groups that observe holidays. */
export interface DayException {
  id: string;
  day: ISODate;
  /** `not_held` for a holiday, `skipped` for "I'm away". */
  effect: CancelReason;
  label: string;
  /** Rows imported or entered together share a batch, so one undo removes them all. */
  batchId: string;
}

// ---------------------------------------------------------------------------
// Occurrences: computed on read, never stored (D-021, D-022)
// ---------------------------------------------------------------------------

/**
 * `${seriesId}:${originalDate}` for occurrences the rule generated,
 * `x:${overrideId}` for extras.
 */
export type OccurrenceKey = `${string}:${string}`;

/** One computed occurrence, ready for the calendar. */
export interface Occurrence {
  key: OccurrenceKey;
  seriesId: string;
  groupId: string;
  title: string;
  subject: string;
  location: string | null;
  /** The date the rule generated. `null` for extras. */
  originalDate: ISODate | null;
  /** The local date it happens on, after any move. */
  date: ISODate;
  start: Instant;
  /** `start` plus the duration in real elapsed minutes. */
  end: Instant;
  /** The zone `start` and `date` are local to. */
  tzid: IanaZone;
  status: 'scheduled' | 'cancelled';
  cancelReason: CancelReason | null;
  cancelOrigin: CancelOrigin | null;
  /** The day exception's label when it caused the cancellation. */
  holidayLabel: string | null;
  /** Placed on a different date or time than the rule says. */
  moved: boolean;
  extra: boolean;
  /** The wall-clock start fell into a daylight-saving gap and was pushed forward (D-025). */
  dstShifted: boolean;
  confirmedAt: Instant | null;
  /** The override's note, if this occurrence has one. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Reserved now so v1/v3 never fork the names (D-050)
// ---------------------------------------------------------------------------

export type SessionKind = 'timer' | 'manual_entry' | 'auto';
export type SessionSource = 'web' | 'vscode' | 'claude_code' | 'git';
