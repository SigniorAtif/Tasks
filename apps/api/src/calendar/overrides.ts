// The `occurrence_override` table: what was said about single occurrences
// (a cancelled class, a lab moved to Friday, a make-up class). v0.2 only read
// it; v0.3 writes the status and cancel reason of one occurrence.

import type {
  DateWindow,
  ISODate,
  ModifiedOverride,
  OccurrenceOverride,
  updateOccurrenceSchema,
} from '@tasks/core';
import { and, between, eq, getTableColumns, inArray, isNull, or } from 'drizzle-orm';
import type { z } from 'zod';
import { occurrenceOverride } from '../db/schema.ts';
import type { UserScope } from '../db/user-scope.ts';
import { toOverride } from './rows.ts';

/**
 * Every override `expand()` could need for the window: those whose original
 * date is in it (the occurrence the rule made there was cancelled, moved out
 * or annotated) and those whose new date is in it (moved in from elsewhere,
 * or an extra, which has only a new date).
 */
export async function listOverridesIn(
  scope: UserScope,
  window: DateWindow,
): Promise<OccurrenceOverride[]> {
  const rows = await scope.tx
    .select()
    .from(occurrenceOverride)
    .where(
      and(
        eq(occurrenceOverride.userId, scope.userId),
        or(
          between(occurrenceOverride.originalDate, window.from, window.to),
          between(occurrenceOverride.newDate, window.from, window.to),
        ),
      ),
    );
  return rows.map(toOverride);
}

/** Every override of these series, whatever its dates: what a new last day could hide. */
export async function listOverridesOf(
  scope: UserScope,
  seriesIds: readonly string[],
): Promise<OccurrenceOverride[]> {
  if (seriesIds.length === 0) return [];
  const rows = await scope.tx
    .select()
    .from(occurrenceOverride)
    .where(
      and(
        eq(occurrenceOverride.userId, scope.userId),
        inArray(occurrenceOverride.seriesId, [...seriesIds]),
      ),
    );
  return rows.map(toOverride);
}

/** A validated occurrence `PATCH` body: the status and cancel reason to set. */
export type OccurrenceChanges = z.output<typeof updateOccurrenceSchema>;

// Columns that only identify the row or keep its history. Every other column is
// something said about the occurrence, so a column added later counts by itself.
// Listed by their typed names, so renaming one of them fails the typecheck here.
type Column = keyof typeof occurrenceOverride.$inferSelect;
const IDENTITY_COLUMNS: ReadonlySet<string> = new Set<Column>([
  'id',
  'userId',
  'seriesId',
  'kind',
  'originalDate',
  'createdAt',
  'updatedAt',
]);

/** True for a row with nothing left to say: no status, reason, move, length, confirmation or note. */
const saysNothing = and(
  ...Object.entries(getTableColumns(occurrenceOverride))
    .filter(([name]) => !IDENTITY_COLUMNS.has(name))
    .map(([, column]) => isNull(column)),
);

/**
 * Sets the status and cancel reason of the occurrence the series generates on
 * `originalDate`. The override row is created when there isn't one and deleted
 * when nothing is left on it, so a client never needs to know whether a row
 * exists; a restore keeps a row that still holds a note. Returns the override
 * as it now is, or `undefined` when there's none left.
 *
 * Two requests for the same occurrence at once (spec #6, edge case 6): the upsert is one
 * statement, so the second can't fail on the unique (series, original date)
 * constraint; it waits and then updates the first one's row. The upsert also
 * locks that row until the transaction ends, so the delete that follows sees
 * exactly what the upsert left, and no other request can slip in between. One
 * statement can't do both: every part of a statement reads the same snapshot,
 * so a DELETE can't see the row its own upsert just wrote.
 */
export async function setCancellation(
  scope: UserScope,
  seriesId: string,
  originalDate: ISODate,
  change: OccurrenceChanges,
): Promise<ModifiedOverride | undefined> {
  const [row] = await scope.tx
    .insert(occurrenceOverride)
    .values({ userId: scope.userId, seriesId, kind: 'modified', originalDate, ...change })
    .onConflictDoUpdate({
      target: [occurrenceOverride.seriesId, occurrenceOverride.originalDate],
      set: { ...change, updatedAt: new Date() },
      // Never false here: the series is this user's, so its overrides are too (D-034).
      setWhere: eq(occurrenceOverride.userId, scope.userId),
    })
    .returning();
  if (!row) throw new Error(`upsert of ${seriesId}:${originalDate} returned no row`);

  const emptied = await scope.tx
    .delete(occurrenceOverride)
    .where(
      and(
        eq(occurrenceOverride.userId, scope.userId),
        eq(occurrenceOverride.id, row.id),
        saysNothing,
      ),
    )
    .returning({ id: occurrenceOverride.id });
  if (emptied.length > 0) return undefined;

  const override = toOverride(row);
  if (override.kind !== 'modified') throw new Error(`override ${row.id} has an original date`);
  return override;
}
