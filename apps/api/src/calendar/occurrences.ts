// One occurrence, named by its series and the date the rule generated
// (D-022). Occurrences aren't rows (D-021): changing one writes its override,
// and the answer is computed again by core's engine, the same way the
// calendar computes it.

import { type ISODate, type Occurrence, occurrenceOn, occursOn } from '@tasks/core';
import type { UserScope } from '../db/user-scope.ts';
import { findGroup } from './groups.ts';
import { type OccurrenceChanges, setCancellation } from './overrides.ts';
import { findSeries } from './series.ts';

/**
 * Cancels, restores or changes the reason of one occurrence, and returns it as
 * the calendar now shows it. `undefined` when there's no such occurrence: the
 * series doesn't exist, isn't this user's, or never generates that date.
 */
export async function changeOccurrence(
  scope: UserScope,
  seriesId: string,
  originalDate: ISODate,
  change: OccurrenceChanges,
): Promise<Occurrence | undefined> {
  const series = await findSeries(scope, seriesId);
  if (!series) return undefined;
  // Always found: the composite foreign key ties a series to a group of the same user.
  const group = await findGroup(scope, series.groupId);
  if (!group || !occursOn(series, originalDate, group)) return undefined;

  const override = await setCancellation(scope, seriesId, originalDate, change);
  // Holidays and days off (`day_exception`) arrive in v0.3b, as in the calendar route.
  return occurrenceOn({ series, group, override, dayExceptions: [] }, originalDate);
}
