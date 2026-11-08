// The calendar as it will be once the queued changes reach the server (#9).
//
// A cancel, restore or change of reason goes into a queue first
// (src/lib/occurrence-queue.ts) and shows at once: the screen draws the cached
// weeks with every queued change applied on top, in the order they were made,
// so the newest one wins. The cache itself only ever holds what the server
// said. That way a refetch, which knows nothing of the queue, can't wipe a
// change that's still waiting, and a change the server refuses simply stops
// being applied: that's its rollback.

import type { ISODate, Occurrence, OccurrenceKey, UpdateOccurrence } from '@tasks/core';
import { dayLabel } from './format.ts';

/** A queued change, as much of it as the calendar needs. */
export interface ShownChange {
  seriesId: string;
  originalDate: ISODate;
  change: UpdateOccurrence;
  /** Waiting for the server (`isWaiting` in lib/occurrence-queue.ts): the block gets a mark. */
  waiting: boolean;
}

/**
 * One occurrence as it will be after `change`. A local guess: the server's
 * answer replaces it once the change arrives.
 */
export function applyChange(occ: Occurrence, change: UpdateOccurrence): Occurrence {
  // `holidayLabel: null` as the engine does for a cancel the user made: their
  // reason shows, not a holiday's.
  if (change.status === 'cancelled') {
    return {
      ...occ,
      status: 'cancelled',
      cancelReason: change.cancelReason,
      cancelOrigin: 'user',
      holidayLabel: null,
    };
  }
  return {
    ...occ,
    status: 'scheduled',
    cancelReason: null,
    cancelOrigin: null,
    holidayLabel: null,
  };
}

const NOTHING_WAITING: ReadonlySet<OccurrenceKey> = new Set();

/**
 * `occurrences` with `queued` applied, oldest change first, and the keys of the
 * occurrences still waiting for the server. With nothing queued, the same list
 * comes back, so the grid doesn't lay itself out again.
 */
export function withQueuedChanges(
  occurrences: readonly Occurrence[],
  queued: readonly ShownChange[],
): { occurrences: readonly Occurrence[]; waitingKeys: ReadonlySet<OccurrenceKey> } {
  if (queued.length === 0) return { occurrences, waitingKeys: NOTHING_WAITING };
  const waitingKeys = new Set<OccurrenceKey>();
  const shown = occurrences.map((occ) => {
    let result = occ;
    for (const q of queued) {
      // Extras have no original date, so a queued change never matches one.
      if (q.seriesId !== occ.seriesId || q.originalDate !== occ.originalDate) continue;
      result = applyChange(result, q.change);
      if (q.waiting) waitingKeys.add(occ.key);
    }
    return result;
  });
  return { occurrences: shown, waitingKeys };
}

/** What the toast says when the server refused a queued change for good. */
export function droppedNotice(dropped: {
  title: string;
  originalDate: ISODate;
  gone: boolean;
}): string {
  const which = `${dropped.title}, ${dayLabel(dropped.originalDate)}`;
  return dropped.gone
    ? `${which}: it's no longer on the calendar, so the change wasn't saved.`
    : `${which}: the server refused the change, so it wasn't saved.`;
}
