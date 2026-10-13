// Two rules every create and update in the calendar tables follows.
//
// Idempotent creates (D-034, D-042): the client makes the id. If a network
// hiccup makes the PWA send the same create twice, the second one must not
// make a second row. The insert says `on conflict (id) do nothing`; when it
// inserted nothing, the id was already taken, and a lookup under row-level
// security tells whose: ours → answer with that row (200), unchanged;
// invisible → someone else's (409 `conflict`).
//
// Refused writes: a constraint failure becomes a 422 naming the field
// (`constraints.ts`) instead of a 500.

import { AppError } from '../http/errors.ts';
import { rejectedWrite } from './constraints.ts';

/** What a create returns: the row, and whether this request made it (201) or found it (200). */
export interface Created<T> {
  row: T;
  created: boolean;
}

/** After an insert that did nothing: the row this user already has, or a 409. */
export function alreadyCreated<T>(visible: T | undefined): Created<T> {
  if (visible === undefined) {
    throw new AppError('conflict', {
      detail: 'That id is already in use. Make a new one and try again.',
    });
  }
  return { row: visible, created: false };
}

/** Runs a write; a constraint failure comes out as a 422 naming one of `sent`. */
export async function guardedWrite<T>(
  sent: readonly string[],
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw rejectedWrite(error, sent) ?? error;
  }
}
