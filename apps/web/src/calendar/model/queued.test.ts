import type { UpdateOccurrence } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import { droppedNotice, type ShownChange, withQueuedChanges } from './queued.ts';
import { occurrence } from './test-builders.ts';

const SKIP: UpdateOccurrence = { status: 'cancelled', cancelReason: 'skipped' };
const PROF: UpdateOccurrence = { status: 'cancelled', cancelReason: 'not_held' };
const NOT_TODAY: UpdateOccurrence = { status: 'cancelled', cancelReason: null };
const RESTORE: UpdateOccurrence = { status: null, cancelReason: null };

/** Tuesday's and Wednesday's DS, and an extra class. */
const TUE = occurrence();
const WED = occurrence({ key: 's:2026-10-07', originalDate: '2026-10-07', date: '2026-10-07' });
const EXTRA = occurrence({ key: 'x:e1', originalDate: null, extra: true });

const queued = (change: UpdateOccurrence, waiting = true, originalDate = '2026-10-06') =>
  ({ seriesId: 's', originalDate, change, waiting }) satisfies ShownChange;

describe('withQueuedChanges', () => {
  it('shows a queued cancel at once, marked as waiting', () => {
    const shown = withQueuedChanges([TUE, WED, EXTRA], [queued(SKIP)]);
    expect(shown.occurrences).toEqual([
      { ...TUE, status: 'cancelled', cancelReason: 'skipped', cancelOrigin: 'user' },
      WED,
      EXTRA,
    ]);
    expect([...shown.waitingKeys]).toEqual([TUE.key]);
  });

  it('applies changes in the order they were made, so the newest wins', () => {
    const skipThenRestore = withQueuedChanges([TUE], [queued(SKIP), queued(RESTORE)]);
    expect(skipThenRestore.occurrences).toEqual([TUE]);

    const reasonChanged = withQueuedChanges([TUE], [queued(PROF), queued(NOT_TODAY), queued(SKIP)]);
    expect(reasonChanged.occurrences[0]).toMatchObject({
      status: 'cancelled',
      cancelReason: 'skipped',
    });
  });

  it('gives a class cancelled for a holiday your own reason instead', () => {
    const holiday = occurrence({
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'holiday',
      holidayLabel: 'Holiday (example)',
    });
    expect(withQueuedChanges([holiday], [queued(SKIP)]).occurrences[0]).toMatchObject({
      cancelReason: 'skipped',
      cancelOrigin: 'user',
      holidayLabel: null,
    });
  });

  it('restores a class the server has as cancelled', () => {
    const cancelled = occurrence({
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'user',
    });
    expect(withQueuedChanges([cancelled], [queued(RESTORE)]).occurrences).toEqual([TUE]);
  });

  it('marks nothing for a change still on its first quick try', () => {
    const shown = withQueuedChanges([TUE], [queued(SKIP, false)]);
    expect(shown.occurrences[0]?.status).toBe('cancelled');
    expect(shown.waitingKeys.size).toBe(0);
  });

  it('hands back the same list when nothing is queued, so the grid keeps its layout', () => {
    const occurrences = [TUE, WED];
    expect(withQueuedChanges(occurrences, []).occurrences).toBe(occurrences);
  });
});

describe('droppedNotice', () => {
  const dropped = { seriesId: 's', originalDate: '2026-10-06', title: 'DS', change: SKIP };

  it('says the occurrence is gone when the server no longer has it', () => {
    expect(droppedNotice({ ...dropped, gone: true })).toBe(
      "DS, Tue 6 Oct: it's no longer on the calendar, so the change wasn't saved.",
    );
  });

  it('says only that it was not saved for any other refusal', () => {
    expect(droppedNotice({ ...dropped, gone: false })).toBe(
      "DS, Tue 6 Oct: the server refused the change, so it wasn't saved.",
    );
  });
});
