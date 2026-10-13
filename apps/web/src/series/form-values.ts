// The series form's data and rules, apart from how it's drawn (SeriesForm.tsx).
//
// The form keeps what the user typed as plain strings, exactly as the inputs
// hold them ('' for an empty box). On Save, these functions turn the strings
// into request bodies, check them with the same zod schemas the API uses
// (@tasks/core's schemas.ts), and turn any problems, ours or the server's,
// into one message per field.

import {
  type ColorToken,
  type CreateGroup,
  type CreateSeries,
  createGroupSchema,
  createSeriesSchema,
  DEFAULT_COLOR_TOKEN,
  type IanaZone,
  type ISODate,
  type ScheduleGroup,
  type Series,
  type UpdateSeries,
  updateSeriesSchema,
  type Weekday,
} from '@tasks/core';
import { Temporal } from 'temporal-polyfill';
import type { FieldError } from '../lib/api.ts';
import { isKnownZone } from '../lib/time.ts';

/** The days, Monday first (B11), as the toggle buttons show them. */
export const WEEKDAYS: readonly { day: Weekday; short: string; long: string }[] = [
  { day: 'MO', short: 'Mon', long: 'Monday' },
  { day: 'TU', short: 'Tue', long: 'Tuesday' },
  { day: 'WE', short: 'Wed', long: 'Wednesday' },
  { day: 'TH', short: 'Thu', long: 'Thursday' },
  { day: 'FR', short: 'Fri', long: 'Friday' },
  { day: 'SA', short: 'Sat', long: 'Saturday' },
  { day: 'SU', short: 'Sun', long: 'Sunday' },
];

/** The "Group" select's value for "make a new group". Never a real id: those are UUIDs. */
export const NEW_GROUP = 'new';

/** What the form holds while the user types. */
export interface SeriesFormValues {
  title: string;
  /** `''` means "the same as the title": the box shows the title as its placeholder. */
  subject: string;
  location: string;
  /** An existing group's id, or `NEW_GROUP`. */
  groupId: string;
  /** Only used when `groupId` is `NEW_GROUP`. */
  newGroup: { name: string; colorToken: ColorToken; activeFrom: string };
  days: Weekday[];
  /** Every N weeks, 1 to 4. */
  interval: number;
  /** `HH:MM` from `<input type="time">`, `''` until picked. */
  startTime: string;
  /** The minutes box, as typed: a string, so it can be empty while editing. */
  durationMin: string;
  startDate: string;
  /** `''` = no last day. */
  untilDate: string;
}

/** Every input that can show an error, in the order they appear on screen. */
export const FIELD_ORDER = [
  'title',
  'subject',
  'location',
  'groupId',
  'groupName',
  'groupColor',
  'groupActiveFrom',
  'days',
  'interval',
  'startTime',
  'durationMin',
  'startDate',
  'untilDate',
] as const;

export type FieldName = (typeof FIELD_ORDER)[number];

/** The labels on screen, also used to start error messages: "Title must not be empty". */
export const LABELS: Record<FieldName, string> = {
  title: 'Title',
  subject: 'Subject',
  location: 'Location',
  groupId: 'Group',
  groupName: 'Group name',
  groupColor: 'Colour',
  groupActiveFrom: 'Group starts on',
  days: 'Days',
  interval: 'Repeats',
  startTime: 'Starts at',
  durationMin: 'Duration in minutes',
  startDate: 'First day',
  untilDate: 'Last day',
};

/** What's wrong with a submission: one message per field, plus any that belong to no field. */
export interface Problems {
  fields: Partial<Record<FieldName, string>>;
  other: string[];
}

export const NO_PROBLEMS: Problems = { fields: {}, other: [] };

export function hasProblems(problems: Problems): boolean {
  return Object.keys(problems.fields).length > 0 || problems.other.length > 0;
}

/** The first field with a problem, in screen order: the one to move the focus to. */
export function firstProblemField(problems: Problems): FieldName | undefined {
  return FIELD_ORDER.find((field) => problems.fields[field] !== undefined);
}

// ---------------------------------------------------------------------------
// Starting values
// ---------------------------------------------------------------------------

/** Today's date in the user's zone (the phone's zone if this browser doesn't know it). */
export function todayIn(tzid: IanaZone, epochMs: number = Date.now()): ISODate {
  const zone = isKnownZone(tzid) ? tzid : Temporal.Now.timeZoneId();
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}

/** The groups the "Group" select offers: every one not archived, plus the series' own. */
export function selectableGroups(
  groups: readonly ScheduleGroup[],
  currentGroupId?: string,
): ScheduleGroup[] {
  return groups.filter((group) => group.archivedAt === null || group.id === currentGroupId);
}

/** A blank form for a new class. With no groups yet, it starts on "New group". */
export function blankValues(today: ISODate, groups: readonly ScheduleGroup[]): SeriesFormValues {
  return {
    title: '',
    subject: '',
    location: '',
    groupId: selectableGroups(groups)[0]?.id ?? NEW_GROUP,
    newGroup: { name: '', colorToken: DEFAULT_COLOR_TOKEN, activeFrom: today },
    days: [],
    interval: 1,
    startTime: '',
    durationMin: '60',
    startDate: today,
    untilDate: '',
  };
}

/**
 * The form filled in from an existing series. A daily rule shows as every day of
 * every week, which is the same thing for "every day" (the form only makes
 * weekly rules); it's only sent back if the user changes the days.
 */
export function valuesFromSeries(series: Series, today: ISODate): SeriesFormValues {
  const { rule } = series;
  return {
    title: series.title,
    subject: series.subject === series.title ? '' : series.subject,
    location: series.location ?? '',
    groupId: series.groupId,
    newGroup: { name: '', colorToken: DEFAULT_COLOR_TOKEN, activeFrom: today },
    days: rule.freq === 'weekly' ? [...rule.byDay] : WEEKDAYS.map((w) => w.day),
    interval: rule.freq === 'weekly' ? rule.interval : 1,
    // Postgres may send `HH:MM:SS`; the time input and the schema want `HH:MM`.
    startTime: series.startTime.slice(0, 5),
    durationMin: String(series.durationMin),
    startDate: series.startDate,
    untilDate: series.untilDate ?? '',
  };
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** Monday first, so the same days always make the same rule (and compare equal). */
function orderedDays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.map((w) => w.day).filter((day) => days.includes(day));
}

/** The fields create and update share. `groupId` is the real id, the new group's included. */
function seriesFields(values: SeriesFormValues, groupId: string) {
  const minutes = values.durationMin.trim();
  return {
    groupId,
    title: values.title,
    location: values.location.trim() === '' ? null : values.location,
    rule: { freq: 'weekly' as const, interval: values.interval, byDay: orderedDays(values.days) },
    startDate: values.startDate,
    untilDate: values.untilDate === '' ? null : values.untilDate,
    startTime: values.startTime,
    // An empty box is "no number", which the schema refuses, not 0.
    durationMin: minutes === '' ? Number.NaN : Number(minutes),
  };
}

/** `POST /api/v1/groups` for the inline "New group" fields. */
export function toCreateGroup(values: SeriesFormValues, id: string): CreateGroup {
  const { name, colorToken, activeFrom } = values.newGroup;
  return { id, name, colorToken, activeFrom };
}

/** `POST /api/v1/series`. `subject` only when the user typed one; the server copies the title. */
export function toCreateSeries(
  values: SeriesFormValues,
  ids: { series: string; group: string },
): CreateSeries {
  return {
    id: ids.series,
    ...seriesFields(values, ids.group),
    ...(values.subject.trim() === '' ? {} : { subject: values.subject }),
  };
}

/**
 * Every field of an edited series as the form shows it now. An empty subject
 * follows the title, as the placeholder promised.
 */
export function toFullUpdate(values: SeriesFormValues, groupId: string): UpdateSeries {
  return {
    ...seriesFields(values, groupId),
    subject: values.subject.trim() === '' ? values.title : values.subject,
  };
}

/**
 * `PATCH /api/v1/series/:id`: only the fields that differ from what the form
 * started with. Anything the user didn't touch isn't sent, so a change made on
 * another device to another field in the meantime isn't overwritten.
 */
export function changedFields(
  values: SeriesFormValues,
  initial: SeriesFormValues,
  groupId: string,
): UpdateSeries {
  const now = toFullUpdate(values, groupId);
  const before = toFullUpdate(initial, initial.groupId);
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(now)) {
    // JSON compares the rule object by content.
    if (JSON.stringify(value) !== JSON.stringify(before[key as keyof UpdateSeries])) {
      changes[key] = value;
    }
  }
  return changes as UpdateSeries;
}

// ---------------------------------------------------------------------------
// Problems: from the schemas here, or from the server's 422
// ---------------------------------------------------------------------------

/** Where each body path is shown. A longer path falls back to its start: `rule.byDay.0` → days. */
const SERIES_PATHS: Record<string, FieldName> = {
  title: 'title',
  subject: 'subject',
  location: 'location',
  groupId: 'groupId',
  rule: 'days',
  'rule.byDay': 'days',
  'rule.interval': 'interval',
  startTime: 'startTime',
  durationMin: 'durationMin',
  startDate: 'startDate',
  untilDate: 'untilDate',
};

const GROUP_PATHS: Record<string, FieldName> = {
  name: 'groupName',
  colorToken: 'groupColor',
  activeFrom: 'groupActiveFrom',
};

function fieldForPath(path: string, paths: Record<string, FieldName>): FieldName | undefined {
  for (const parts = path.split('.'); parts.length > 0; parts.pop()) {
    const field = paths[parts.join('.')];
    if (field !== undefined) return field;
  }
  return undefined;
}

/** Schema messages name other fields by their JSON names; say what the screen says. */
const FIELD_WORDS: Record<string, string> = {
  startDate: 'the first day',
  activeFrom: 'the day the group starts',
};

/**
 * A schema message as a sentence about one field. The schemas' messages are
 * written to follow a field name ("must not be empty"), so they get the
 * label in front: "Title must not be empty". Others are just capitalised.
 */
export function fieldMessage(field: FieldName, message: string): string {
  const text = message.replace(/\b(startDate|activeFrom)\b/g, (word) => FIELD_WORDS[word] ?? word);
  if (/^(must|is|has)\b/.test(text)) return `${LABELS[field]} ${text}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Turns `{ path, message }` pairs (the server's 422, or our own check) into `Problems`. */
export function problemsFromErrors(
  errors: readonly FieldError[],
  body: 'series' | 'group',
): Problems {
  const paths = body === 'series' ? SERIES_PATHS : GROUP_PATHS;
  const problems: Problems = { fields: {}, other: [] };
  for (const { path, message } of errors) {
    const field = fieldForPath(path, paths);
    if (field === undefined) problems.other.push(path === '' ? message : `${path}: ${message}`);
    // Only the first message per field: one thing to fix at a time.
    else problems.fields[field] ??= fieldMessage(field, message);
  }
  return problems;
}

export function mergeProblems(a: Problems, b: Problems): Problems {
  return { fields: { ...b.fields, ...a.fields }, other: [...a.other, ...b.other] };
}

type ParseOptions = NonNullable<Parameters<typeof createSeriesSchema.safeParse>[1]>;

/**
 * Messages for the checks the schemas don't word themselves (zod's defaults read
 * like "Too small: expected number to be >=1"). `undefined` keeps zod's own.
 */
const friendlierMessages: ParseOptions['error'] = (issue) => {
  if (issue.code === 'invalid_type' && issue.expected === 'number') return 'must be a number';
  if (issue.code === 'invalid_type' && issue.expected === 'int') return 'must be a whole number';
  if (issue.code === 'too_small' && issue.origin === 'number') {
    return `must be at least ${issue.minimum}`;
  }
  if (issue.code === 'too_big' && issue.origin === 'number') {
    return `must be at most ${issue.maximum}`;
  }
  if (issue.code === 'too_big' && issue.origin === 'string') {
    return `must be at most ${issue.maximum} characters`;
  }
  return undefined;
};

/** The part of a zod schema `check` uses, so it takes any of the three. */
interface Schema {
  safeParse(
    input: unknown,
    options: ParseOptions,
  ): { error?: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

/** Runs a schema and turns its issues into `{ path, message }` pairs, like the server's. */
function check(schema: Schema, input: unknown): FieldError[] {
  const { error } = schema.safeParse(input, { error: friendlierMessages });
  if (error === undefined) return [];
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** The new group's fields, checked by the API's own `createGroupSchema`. */
export function checkGroup(input: CreateGroup): Problems {
  return problemsFromErrors(check(createGroupSchema, input), 'group');
}

/**
 * "The last day is before the first" on its own. zod runs a check that compares
 * two fields only once every field is valid, so with an empty title as well the
 * full check wouldn't mention the dates yet. Checking just the two dates with the
 * same schema shows every problem at once instead of one round at a time.
 */
function checkDateOrder(input: { startDate?: string; untilDate?: string | null }): Problems {
  const dates = { startDate: input.startDate, untilDate: input.untilDate };
  return problemsFromErrors(check(updateSeriesSchema, dates), 'series');
}

/** A new series, checked by the API's own `createSeriesSchema`. */
export function checkCreateSeries(input: CreateSeries): Problems {
  return mergeProblems(
    problemsFromErrors(check(createSeriesSchema, input), 'series'),
    checkDateOrder(input),
  );
}

/** An edited series: every field, so the date order is checked too, by `updateSeriesSchema`. */
export function checkUpdateSeries(input: UpdateSeries): Problems {
  return mergeProblems(
    problemsFromErrors(check(updateSeriesSchema, input), 'series'),
    checkDateOrder(input),
  );
}
