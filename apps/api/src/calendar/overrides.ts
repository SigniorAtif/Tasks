// The `occurrence_override` table: what was said about single occurrences
// (a cancelled class, a lab moved to Friday, a make-up class). v0.2 only reads
// it; v0.3 starts writing it.

import type { DateWindow, OccurrenceOverride } from '@tasks/core';
import { and, between, eq, or } from 'drizzle-orm';
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
