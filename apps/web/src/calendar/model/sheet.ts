// What the occurrence sheet offers. Tapping a class opens a sheet for that one
// occurrence; which buttons it shows depends on the occurrence's state, its
// group's attendance setting, and any change still on its way to the server.
// Kept apart from React, so the rules are tested in Node.

import type { CancelReason, Occurrence, ScheduleGroup, UpdateOccurrence } from '@tasks/core';
import { reasonLabel } from './format.ts';

/** A button that cancels the occurrence, or changes the reason it was cancelled for. */
export interface CancelButton {
  /** The first word, which never changes, so the right one is found at 8 am without reading. */
  word: 'Prof' | 'Me' | 'Not today';
  /** The small line under the word (#15 makes it rotate). `null` under Not today. */
  line: string | null;
  /** The body of the `PATCH` the button sends. */
  change: UpdateOccurrence;
}

/** What the sheet shows for one occurrence; an empty list shows nothing. */
export interface SheetActions {
  /** How the occurrence stands, in words, such as "I skipped". `null` while it's on. */
  state: string | null;
  /** Shown while the class is on. */
  cancel: CancelButton[];
  /** The `PATCH` body that takes the cancel back, while it's cancelled; else `null`. */
  restore: UpdateOccurrence | null;
  /** The reasons it could switch to, while cancelled in a group that tracks attendance. */
  changeReason: CancelButton[];
}

/** The `PATCH` body of Restore, and of Undo, which does exactly the same. */
export const RESTORE: UpdateOccurrence = { status: null, cancelReason: null };

const PROF: CancelButton = {
  word: 'Prof',
  line: "Class didn't happen",
  change: { status: 'cancelled', cancelReason: 'not_held' },
};
const ME: CancelButton = {
  word: 'Me',
  line: "I didn't go",
  change: { status: 'cancelled', cancelReason: 'skipped' },
};
const NOT_TODAY: CancelButton = {
  word: 'Not today',
  line: null,
  change: { status: 'cancelled', cancelReason: null },
};

const NOTHING: SheetActions = { state: null, cancel: [], restore: null, changeReason: [] };

/**
 * The actions for one occurrence. A saved reason is always shown as it was saved,
 * whatever the group's attendance setting is now; a cancel saved with no reason
 * reads "No reason given" in a group that tracks attendance, and is never guessed.
 */
export function sheetActions(
  occ: Pick<Occurrence, 'status' | 'cancelReason' | 'originalDate'>,
  group: Pick<ScheduleGroup, 'attendance'>,
  pending?: UpdateOccurrence,
): SheetActions {
  // An extra has no original date to name it by; changing one arrives with extras in v0.3b.
  if (occ.originalDate === null) return NOTHING;

  // A change on its way shows as done, so the sheet never offers to undo what's in flight.
  const status = pending ? (pending.status ?? 'scheduled') : occ.status;
  const reason = pending ? (pending.cancelReason ?? null) : occ.cancelReason;

  if (status !== 'cancelled') {
    return { ...NOTHING, cancel: group.attendance ? [PROF, ME] : [NOT_TODAY] };
  }
  return {
    state: reasonInWords(reason, group.attendance),
    cancel: [],
    restore: RESTORE,
    changeReason: group.attendance
      ? [PROF, ME].filter((b) => b.change.cancelReason !== reason)
      : [],
  };
}

function reasonInWords(reason: CancelReason | null, attendance: boolean): string {
  return reasonLabel(reason) ?? (attendance ? 'No reason given' : 'Cancelled');
}
