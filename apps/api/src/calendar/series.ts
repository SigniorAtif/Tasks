// The `series` table: one timing pattern each ("Data Structures, Mondays,
// Wednesdays and Fridays at 08:00 for 60 minutes"). Same rules as groups.ts:
// every function takes a `UserScope` and still filters by `scope.userId`.
//
// `group_id` is checked by Postgres, not here: the composite foreign key
// `(user_id, group_id)` only accepts a group of the same user, and a refusal
// comes out of `guardedWrite` as a 422 on `groupId`.

import type { createSeriesSchema, Series, updateSeriesSchema } from '@tasks/core';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { series } from '../db/schema.ts';
import type { UserScope } from '../db/user-scope.ts';
import { toSeries } from './rows.ts';
import { alreadyCreated, type Created, guardedWrite } from './writes.ts';

/**
 * A validated `POST` body with its zone decided: the route fills in the
 * user's profile zone when the request didn't send one.
 */
export type NewSeries = Omit<z.output<typeof createSeriesSchema>, 'tzid'> & { tzid: string };
/** A validated `PATCH` body: only the fields being changed. */
export type SeriesChanges = z.output<typeof updateSeriesSchema>;

const mine = (scope: UserScope, id: string) =>
  and(eq(series.userId, scope.userId), eq(series.id, id));

/** Every series in every group, by title. */
export async function listSeries(scope: UserScope): Promise<Series[]> {
  const rows = await scope.tx
    .select()
    .from(series)
    .where(eq(series.userId, scope.userId))
    .orderBy(asc(series.title), asc(series.id));
  return rows.map(toSeries);
}

export async function findSeries(scope: UserScope, id: string): Promise<Series | undefined> {
  const [row] = await scope.tx.select().from(series).where(mine(scope, id));
  return row && toSeries(row);
}

/** Inserts the series, or finds the one an earlier attempt with the same id made. */
export async function createSeries(scope: UserScope, input: NewSeries): Promise<Created<Series>> {
  const [row] = await guardedWrite(Object.keys(input), () =>
    scope.tx
      .insert(series)
      .values({ ...input, userId: scope.userId })
      .onConflictDoNothing({ target: series.id })
      .returning(),
  );
  if (row) return { row: toSeries(row), created: true };
  return alreadyCreated(await findSeries(scope, input.id));
}

/**
 * Applies the changes to every occurrence, past ones too (see `updateSeriesSchema`;
 * v0.3b adds "this and following" through a split). `undefined` if there's no such series.
 */
export async function updateSeries(
  scope: UserScope,
  id: string,
  changes: SeriesChanges,
): Promise<Series | undefined> {
  const sent = Object.keys(changes);
  if (sent.length === 0) return findSeries(scope, id);
  const [row] = await guardedWrite(sent, () =>
    scope.tx.update(series).set(changes).where(mine(scope, id)).returning(),
  );
  return row && toSeries(row);
}

/** Deletes the series and its overrides (the foreign key cascades). */
export async function deleteSeries(scope: UserScope, id: string): Promise<boolean> {
  const deleted = await scope.tx.delete(series).where(mine(scope, id)).returning({ id: series.id });
  return deleted.length > 0;
}
