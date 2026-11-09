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
import {
  type FieldMap,
  fieldSentence,
  firstProblem,
  mergeProblems,
  type Problems,
  problemsFor,
  schemaErrors,
} from '../lib/form-problems.ts';
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
  newGroup: { name: string; colorToken: ColorToken };
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
  days: 'Days',
  interval: 'Repeats',
  startTime: 'Starts at',
  durationMin: 'Duration in minutes',
  startDate: 'First day',
  untilDate: 'Last day',
};

/** The first field with a problem, in screen order: the one to move the focus to. */
export function firstProblemField(problems: Problems<FieldName>): FieldName | undefined {
  return firstProblem(problems, FIELD_ORDER);
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

/**
 * A group is archived once its last day is before today. A stand-in until the
 * shared helper in core, which also honours the profile's day boundary (#11).
 */
export function isArchived(group: Pick<ScheduleGroup, 'untilDate'>, today: ISODate): boolean {
  return group.untilDate !== null && group.untilDate < today;
}

/** The groups the "Group" select offers: every one not archived, plus the series' own. */
export function selectableGroups(
  groups: readonly ScheduleGroup[],
  today: ISODate,
  currentGroupId?: string,
): ScheduleGroup[] {
  return groups.filter((group) => !isArchived(group, today) || group.id === currentGroupId);
}

/** Where each series sits and when it starts: all a first-day suggestion needs. */
export type SeriesFirstDays = readonly Pick<Series, 'groupId' | 'startDate'>[];

/**
 * The first day a new series in this group suggests: the earliest first day of a
 * series already in it that is still to come, else today. Adding a semester's
 * twenty classes then means typing its first day once.
 */
export function suggestedFirstDay(
  groupId: string,
  seriesList: SeriesFirstDays,
  today: ISODate,
): ISODate {
  const upcoming = seriesList
    .filter((s) => s.groupId === groupId && s.startDate >= today)
    .map((s) => s.startDate)
    .sort();
  return upcoming[0] ?? today;
}

/**
 * A new class put in another group. Its first day follows that group's
 * suggestion, unless the user already changed it from the old group's.
 */
export function withGroupChosen(
  values: SeriesFormValues,
  groupId: string,
  seriesList: SeriesFirstDays,
  today: ISODate,
): SeriesFormValues {
  const untouched = values.startDate === suggestedFirstDay(values.groupId, seriesList, today);
  return {
    ...values,
    groupId,
    startDate: untouched ? suggestedFirstDay(groupId, seriesList, today) : values.startDate,
  };
}

/** A blank form for a new class. With no groups yet, it starts on "New group". */
export function blankValues(
  today: ISODate,
  groups: readonly ScheduleGroup[],
  seriesList: SeriesFirstDays = [],
): SeriesFormValues {
  const groupId = selectableGroups(groups, today)[0]?.id ?? NEW_GROUP;
  return {
    title: '',
    subject: '',
    location: '',
    groupId,
    newGroup: { name: '', colorToken: DEFAULT_COLOR_TOKEN },
    days: [],
    interval: 1,
    startTime: '',
    durationMin: '60',
    startDate: suggestedFirstDay(groupId, seriesList, today),
    untilDate: '',
  };
}

/**
 * The form filled in from an existing series. A daily rule shows as every day of
 * every week, which is the same thing for "every day" (the form only makes
 * weekly rules); it's only sent back if the user changes the days.
 */
export function valuesFromSeries(series: Series): SeriesFormValues {
  const { rule } = series;
  return {
    title: series.title,
    subject: series.subject === series.title ? '' : series.subject,
    location: series.location ?? '',
    groupId: series.groupId,
    newGroup: { name: '', colorToken: DEFAULT_COLOR_TOKEN },
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
  const { name, colorToken } = values.newGroup;
  return { id, name, colorToken };
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

/** Schema messages name other fields by their JSON names; say what the screen says. */
const FIELD_WORDS: Record<string, string> = {
  startDate: 'the first day',
};

/** A schema message as a sentence about one field: "Title must not be empty". */
export function fieldMessage(field: FieldName, message: string): string {
  const text = message.replace(/\bstartDate\b/g, (word) => FIELD_WORDS[word] ?? word);
  return fieldSentence(LABELS[field], text);
}

/** Where each series body path is shown. A longer path falls back to its start: `rule.byDay.0` → days. */
const SERIES_FIELDS: FieldMap<FieldName> = {
  paths: {
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
  },
  sentence: fieldMessage,
};

/** The series form's inline "New group" fields. */
const NEW_GROUP_FIELDS: FieldMap<FieldName> = {
  paths: { name: 'groupName', colorToken: 'groupColor' },
  sentence: fieldMessage,
};

/** Turns `{ path, message }` pairs (the server's 422, or our own check) into `Problems`. */
export function problemsFromErrors(
  errors: readonly FieldError[],
  body: 'series' | 'group',
): Problems<FieldName> {
  return problemsFor(errors, body === 'series' ? SERIES_FIELDS : NEW_GROUP_FIELDS);
}

/** The new group's fields, checked by the API's own `createGroupSchema`. */
export function checkGroup(input: CreateGroup): Problems<FieldName> {
  return problemsFromErrors(schemaErrors(createGroupSchema, input), 'group');
}

/**
 * "The last day is before the first" on its own. zod skips a check that compares
 * two fields when any field has the wrong type, and an empty duration box arrives
 * as NaN, which zod counts as the wrong type. Then the full check wouldn't mention
 * the dates yet. Checking just the two dates with the same schema shows every
 * problem at once instead of one round at a time.
 */
function checkDateOrder(input: {
  startDate?: string;
  untilDate?: string | null;
}): Problems<FieldName> {
  const dates = { startDate: input.startDate, untilDate: input.untilDate };
  return problemsFromErrors(schemaErrors(updateSeriesSchema, dates), 'series');
}

/** A new series, checked by the API's own `createSeriesSchema`. */
export function checkCreateSeries(input: CreateSeries): Problems<FieldName> {
  return mergeProblems(
    problemsFromErrors(schemaErrors(createSeriesSchema, input), 'series'),
    checkDateOrder(input),
  );
}

/** An edited series: every field, so the date order is checked too, by `updateSeriesSchema`. */
export function checkUpdateSeries(input: UpdateSeries): Problems<FieldName> {
  return mergeProblems(
    problemsFromErrors(schemaErrors(updateSeriesSchema, input), 'series'),
    checkDateOrder(input),
  );
}
