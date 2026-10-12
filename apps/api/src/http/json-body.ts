// Reading a JSON request body in two steps, each with its own error (D-043):
// 1. Is it JSON at all?            No → 400 `malformed_request`.
// 2. Does it have the right shape? No → 422 `validation_failed`, one entry per field.
// v0.0 has no routes with bodies yet; v0.2's "create a series" is the first user.

import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError, validationFailed } from './errors.ts';

export async function jsonBody<Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch (error) {
    throw new AppError('malformed_request', {
      detail: 'The request body is not valid JSON.',
      cause: error,
    });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailed(result.error);
  return result.data;
}
