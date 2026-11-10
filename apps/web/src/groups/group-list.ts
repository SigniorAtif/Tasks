// What the Groups screen lists, and in which order (GroupList.tsx draws it).

import { type ISODate, isArchived, type ScheduleGroup } from '@tasks/core';
import { dateLabel } from '../calendar/model/format.ts';

/**
 * Names in the order people expect: case doesn't matter, and numbers count, so
 * "Sem 10" comes after "Sem 9". The server sorts by name too, but by Postgres'
 * rules, which put "Sem 10" before "Sem 9".
 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Groups by name, the one order every screen lists them in. */
export function sortedByName(groups: readonly ScheduleGroup[]): ScheduleGroup[] {
  // The id breaks a tie, so two groups with one name keep a fixed order.
  return [...groups].sort((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/**
 * The groups still running (no last day, or one not yet passed) and the
 * archived ones, each sorted by name. `today` is the user's day (`todayFor`).
 */
export function groupSections(
  groups: readonly ScheduleGroup[],
  today: ISODate,
): { active: ScheduleGroup[]; archived: ScheduleGroup[] } {
  const sorted = sortedByName(groups);
  return {
    active: sorted.filter((group) => !isArchived(group, today)),
    archived: sorted.filter((group) => isArchived(group, today)),
  };
}

/**
 * The line under a group's name: whether it counts attendance, and its last
 * day, or the day it ended once archived. Empty when there's neither.
 */
export function groupSummary(group: ScheduleGroup, today: ISODate): string {
  const parts: string[] = [];
  if (group.attendance) parts.push('Counts attendance');
  if (group.untilDate !== null) {
    const day = dateLabel(group.untilDate);
    parts.push(isArchived(group, today) ? `Ended ${day}` : `Last day ${day}`);
  }
  return parts.join(' · ');
}
