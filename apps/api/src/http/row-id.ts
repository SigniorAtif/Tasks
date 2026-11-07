// The `:id` in paths like `/api/v1/groups/:id`.

import { z } from 'zod';
import { AppError } from './errors.ts';

const uuid = z.uuid();

/**
 * What a 404 names. An occurrence isn't a row (D-021): it's named by its series id
 * and original date.
 */
type ResourceKind = 'group' | 'series' | 'occurrence';

/**
 * Returns the id if it's a UUID. Anything else is a 404, the same answer as a
 * UUID nobody has: no row can have that id. (Sending it to Postgres would fail
 * on the conversion to `uuid`, which would be a 500.)
 */
export function rowId(raw: string, what: ResourceKind): string {
  if (!uuid.safeParse(raw).success) throw noSuchRow(what);
  return raw;
}

/** The 404 for a row that doesn't exist or belongs to someone else: the two look the same. */
export function noSuchRow(what: ResourceKind): AppError {
  return new AppError('not_found', { detail: `No ${what} with that id.` });
}
