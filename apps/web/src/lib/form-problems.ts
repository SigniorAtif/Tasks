// What's wrong with a form, one message per field: from the API's own zod
// schemas before anything is sent, or from the server's 422 after. Each form
// names its fields and labels (series/form-values.ts, groups/group-form.ts);
// this module turns `{ path, message }` pairs into sentences on those fields.

import type { createGroupSchema } from '@tasks/core';
import type { FieldError } from './api.ts';

/** What's wrong with a submission: one message per field, plus any that belong to no field. */
export interface Problems<Field extends string> {
  fields: Partial<Record<Field, string>>;
  other: string[];
}

export const NO_PROBLEMS: Problems<never> = { fields: {}, other: [] };

export function hasProblems(problems: Problems<string>): boolean {
  return Object.keys(problems.fields).length > 0 || problems.other.length > 0;
}

/** Both sets of problems; where both name a field, `a`'s message wins. */
export function mergeProblems<Field extends string>(
  a: Problems<Field>,
  b: Problems<Field>,
): Problems<Field> {
  return { fields: { ...b.fields, ...a.fields }, other: [...a.other, ...b.other] };
}

/** The first field with a problem in `order` (screen order): the one to move the focus to. */
export function firstProblem<Field extends string>(
  problems: Problems<Field>,
  order: readonly Field[],
): Field | undefined {
  return order.find((field) => problems.fields[field] !== undefined);
}

/**
 * A schema message as a sentence about one field. The schemas' messages are
 * written to follow a field name ("must not be empty"), so they get the
 * label in front: "Title must not be empty". Others are just capitalised.
 */
export function fieldSentence(label: string, message: string): string {
  if (/^(must|is|has)\b/.test(message)) return `${label} ${message}`;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** How one form shows a body's errors: which field each path belongs to, and its label. */
export interface FieldMap<Field extends string> {
  /** Body path → field. A longer path falls back to its start: `rule.byDay.0` → `rule.byDay`. */
  paths: Readonly<Record<string, Field>>;
  /** The message as shown on that field. */
  sentence: (field: Field, message: string) => string;
}

function fieldForPath<Field extends string>(
  path: string,
  paths: Readonly<Record<string, Field>>,
): Field | undefined {
  for (const parts = path.split('.'); parts.length > 0; parts.pop()) {
    const field = paths[parts.join('.')];
    if (field !== undefined) return field;
  }
  return undefined;
}

/** Turns `{ path, message }` pairs (the server's 422, or our own check) into `Problems`. */
export function problemsFor<Field extends string>(
  errors: readonly FieldError[],
  { paths, sentence }: FieldMap<Field>,
): Problems<Field> {
  const problems: Problems<Field> = { fields: {}, other: [] };
  for (const { path, message } of errors) {
    const field = fieldForPath(path, paths);
    if (field === undefined) problems.other.push(path === '' ? message : `${path}: ${message}`);
    // Only the first message per field: one thing to fix at a time.
    else problems.fields[field] ??= sentence(field, message);
  }
  return problems;
}

// Every zod schema takes the same parse options; one schema's type names them.
type ParseOptions = NonNullable<Parameters<typeof createGroupSchema.safeParse>[1]>;

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

/** The part of a zod schema `schemaErrors` uses, so it takes any of them. */
interface Schema {
  safeParse(
    input: unknown,
    options: ParseOptions,
  ): { error?: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } };
}

/** Runs a schema and turns its issues into `{ path, message }` pairs, like the server's. */
export function schemaErrors(schema: Schema, input: unknown): FieldError[] {
  const { error } = schema.safeParse(input, { error: friendlierMessages });
  if (error === undefined) return [];
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}
