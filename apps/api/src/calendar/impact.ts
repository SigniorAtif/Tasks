// What a new last day would hide (`GET .../impact`). The phone can't work it
// out itself: it holds only the weeks it has loaded, and a change can be on
// any date. So the server loads every override of the group's or series'
// classes and asks the engine which of them would stop showing.

import {
  type Impact,
  type ISODate,
  type SeriesImpact,
  type SeriesImpactQuery,
  stopShowing,
} from '@tasks/core';
import type { UserScope } from '../db/user-scope.ts';
import { findGroup } from './groups.ts';
import { listOverridesOf } from './overrides.ts';
import { findSeries, listSeries } from './series.ts';

/**
 * What giving the group `lastDay` would hide, in every series in it.
 * `undefined` if there's no such group. No `lastDay`, nothing changes.
 */
export async function groupImpact(
  scope: UserScope,
  id: string,
  lastDay: ISODate | undefined,
): Promise<Impact | undefined> {
  const group = await findGroup(scope, id);
  if (!group) return undefined;
  const inGroup = (await listSeries(scope)).filter((s) => s.groupId === id);
  const overrides = await listOverridesOf(
    scope,
    inGroup.map((s) => s.id),
  );
  const current = { groups: [group], series: inGroup };
  const proposed = {
    groups: [{ ...group, untilDate: lastDay ?? group.untilDate }],
    series: inGroup,
  };
  return { changesAfter: stopShowing(overrides, current, proposed).length };
}

/**
 * What giving one series a new last day, first day or weekly timing would hide.
 * `undefined` if there's no such series.
 */
export async function seriesImpact(
  scope: UserScope,
  id: string,
  ask: SeriesImpactQuery,
): Promise<SeriesImpact | undefined> {
  const series = await findSeries(scope, id);
  if (!series) return undefined;
  // Always found: the composite foreign key ties a series to a group of the same user.
  const group = await findGroup(scope, series.groupId);
  if (!group) return undefined;
  const overrides = await listOverridesOf(scope, [id]);
  const { byDay, interval } = ask;
  const next = {
    ...series,
    startDate: ask.firstDay ?? series.startDate,
    untilDate: ask.lastDay ?? series.untilDate,
    rule:
      byDay === undefined || interval === undefined
        ? series.rule
        : { freq: 'weekly' as const, interval, byDay },
  };
  const hidden = stopShowing(
    overrides,
    { groups: [group], series: [series] },
    { groups: [group], series: [next] },
  );

  // Each change once, by the date it shows on: before the new first day, after
  // the new last day, or else on a day the new timing doesn't produce.
  const counts: SeriesImpact = { changesAfter: 0, changesBefore: 0, changesOffTiming: 0 };
  for (const o of hidden) {
    const date = o.kind === 'extra' ? o.newDate : o.originalDate;
    if (date < next.startDate) counts.changesBefore += 1;
    else if (next.untilDate !== null && date > next.untilDate) counts.changesAfter += 1;
    else counts.changesOffTiming += 1;
  }
  return counts;
}
