// The group form's data and rules, apart from how it's drawn (GroupForm.tsx).
//
// Like the series form, it keeps what the user typed as plain strings ('' for
// an empty box), and turns them into request bodies on Save.

import {
  type ColorToken,
  type CreateGroup,
  DEFAULT_COLOR_TOKEN,
  type ScheduleGroup,
  type UpdateGroup,
  updateGroupSchema,
} from '@tasks/core';
import type { FieldError } from '../lib/api.ts';
import {
  type FieldMap,
  fieldSentence,
  firstProblem,
  type Problems,
  problemsFor,
  schemaErrors,
} from '../lib/form-problems.ts';

/** What the form holds while the user types. "Observes holidays" waits for v0.3b. */
export interface GroupFormValues {
  name: string;
  colorToken: ColorToken;
  /** Cancels ask for a reason (not held or skipped), so attendance can be counted. */
  attendance: boolean;
  /** `''` = no last day. */
  untilDate: string;
}

/** The inputs that can show an error, in screen order. Attendance is a checkbox: never wrong. */
export const GROUP_FIELD_ORDER = ['name', 'colorToken', 'untilDate'] as const;

export type GroupField = (typeof GROUP_FIELD_ORDER)[number];

/** The labels on screen, also used to start error messages: "Name must not be empty". */
export const GROUP_LABELS: Record<GroupField, string> = {
  name: 'Name',
  colorToken: 'Colour',
  untilDate: 'Last day',
};

/** A blank form. Attendance starts on, as the API's own default does. */
export function blankGroupValues(): GroupFormValues {
  return { name: '', colorToken: DEFAULT_COLOR_TOKEN, attendance: true, untilDate: '' };
}

/** The form filled in from an existing group. */
export function valuesFromGroup(group: ScheduleGroup): GroupFormValues {
  return {
    name: group.name,
    colorToken: group.colorToken,
    attendance: group.attendance,
    untilDate: group.untilDate ?? '',
  };
}

/** The fields create and update share, as the API takes them. */
function groupFields(values: GroupFormValues) {
  return {
    name: values.name,
    colorToken: values.colorToken,
    attendance: values.attendance,
    untilDate: values.untilDate === '' ? null : values.untilDate,
  };
}

/** `POST /api/v1/groups`. */
export function groupCreateBody(values: GroupFormValues, id: string): CreateGroup {
  return { id, ...groupFields(values) };
}

/**
 * `PATCH /api/v1/groups/:id`: only the fields that differ from what the form
 * started with, so a change made on another device to another field in the
 * meantime isn't overwritten.
 */
export function groupChanges(values: GroupFormValues, initial: GroupFormValues): UpdateGroup {
  const now = groupFields(values);
  const before = groupFields(initial);
  const changes: UpdateGroup = {};
  if (now.name !== before.name) changes.name = now.name;
  if (now.colorToken !== before.colorToken) changes.colorToken = now.colorToken;
  if (now.attendance !== before.attendance) changes.attendance = now.attendance;
  if (now.untilDate !== before.untilDate) changes.untilDate = now.untilDate;
  return changes;
}

/** The body's paths are the field names themselves. */
const GROUP_FORM_FIELDS: FieldMap<GroupField> = {
  paths: { name: 'name', colorToken: 'colorToken', untilDate: 'untilDate' },
  sentence: (field, message) => fieldSentence(GROUP_LABELS[field], message),
};

/** Turns `{ path, message }` pairs (the server's 422, or our own check) into `Problems`. */
export function groupProblemsFromErrors(errors: readonly FieldError[]): Problems<GroupField> {
  return problemsFor(errors, GROUP_FORM_FIELDS);
}

/**
 * Every field as the form shows it, checked by the API's own schema. The update
 * schema takes the same fields as create, without the id.
 */
export function checkGroupForm(values: GroupFormValues): Problems<GroupField> {
  return groupProblemsFromErrors(schemaErrors(updateGroupSchema, groupFields(values)));
}

/** The first field with a problem, in screen order: the one to move the focus to. */
export function firstGroupProblem(problems: Problems<GroupField>): GroupField | undefined {
  return firstProblem(problems, GROUP_FIELD_ORDER);
}
