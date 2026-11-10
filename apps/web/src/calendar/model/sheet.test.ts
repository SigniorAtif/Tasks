import { describe, expect, it } from 'vitest';
import { sheetActions } from './sheet.ts';
import { occurrence } from './test-builders.ts';

const PROF = { status: 'cancelled', cancelReason: 'not_held' } as const;
const ME = { status: 'cancelled', cancelReason: 'skipped' } as const;
/** The user's day, which only picks the lines under Prof and Me. */
const DAY = '2026-10-06';

const NOT_TODAY = { status: 'cancelled', cancelReason: null } as const;
const RESTORE = { status: null, cancelReason: null } as const;

const scheduled = occurrence();
const cancelled = (cancelReason: 'not_held' | 'skipped' | null) =>
  occurrence({ status: 'cancelled', cancelReason, cancelOrigin: 'user' });

/** What a person sees: the state line and the words on each button. */
function shown(actions: ReturnType<typeof sheetActions>) {
  return {
    state: actions.state,
    cancel: actions.cancel.map((b) => b.word),
    restore: actions.restore !== null,
    changeReason: actions.changeReason.map((b) => b.word),
  };
}

describe('sheetActions', () => {
  describe('a class that is on', () => {
    it('offers Prof and Me in a group that tracks attendance', () => {
      const actions = sheetActions(scheduled, { attendance: true }, DAY);
      expect(shown(actions)).toEqual({
        state: null,
        cancel: ['Prof', 'Me'],
        restore: false,
        changeReason: [],
      });
      expect(actions.cancel.map((b) => b.change)).toEqual([PROF, ME]);
    });

    it('puts a small line under Prof and Me, and keeps their first word', () => {
      const [prof, me] = sheetActions(scheduled, { attendance: true }, DAY).cancel;
      expect(prof?.line).toBeTruthy();
      expect(me?.line).toBeTruthy();
      expect(prof?.line).not.toBe(me?.line);
    });

    it('changes the line with the day, never the word or what the button sends', () => {
      const today = sheetActions(scheduled, { attendance: true }, DAY).cancel;
      const tomorrow = sheetActions(scheduled, { attendance: true }, '2026-10-07').cancel;
      expect(tomorrow.map((b) => b.line)).not.toEqual(today.map((b) => b.line));
      expect(tomorrow.map((b) => b.word)).toEqual(['Prof', 'Me']);
      expect(tomorrow.map((b) => b.change)).toEqual(today.map((b) => b.change));
    });

    it('offers one Not today, with no reason, in a group without attendance', () => {
      const actions = sheetActions(scheduled, { attendance: false }, DAY);
      expect(shown(actions)).toEqual({
        state: null,
        cancel: ['Not today'],
        restore: false,
        changeReason: [],
      });
      expect(actions.cancel[0]?.change).toEqual(NOT_TODAY);
    });
  });

  describe('a cancelled class', () => {
    it('says why, offers Restore, and offers the other reason', () => {
      expect(shown(sheetActions(cancelled('not_held'), { attendance: true }, DAY))).toEqual({
        state: 'Prof cancelled',
        cancel: [],
        restore: true,
        changeReason: ['Me'],
      });
      expect(shown(sheetActions(cancelled('skipped'), { attendance: true }, DAY))).toEqual({
        state: 'I skipped',
        cancel: [],
        restore: true,
        changeReason: ['Prof'],
      });
    });

    it('restores with no status and no reason', () => {
      expect(sheetActions(cancelled('skipped'), { attendance: true }, DAY).restore).toEqual(
        RESTORE,
      );
    });

    it('reads "No reason given" for a reasonless cancel in an attendance group, never a guess', () => {
      // A "Not today" from before the group turned attendance on (edge case 4).
      const actions = sheetActions(cancelled(null), { attendance: true }, DAY);
      expect(shown(actions)).toEqual({
        state: 'No reason given',
        cancel: [],
        restore: true,
        changeReason: ['Prof', 'Me'],
      });
      expect(actions.changeReason.map((b) => b.change)).toEqual([PROF, ME]);
    });

    it('offers only Restore in a group without attendance, and keeps a saved reason', () => {
      expect(shown(sheetActions(cancelled(null), { attendance: false }, DAY))).toEqual({
        state: 'Cancelled',
        cancel: [],
        restore: true,
        changeReason: [],
      });
      // Saved while the group still tracked attendance: turning it off rewrites nothing.
      expect(sheetActions(cancelled('skipped'), { attendance: false }, DAY).state).toBe(
        'I skipped',
      );
    });
  });

  it('offers nothing on an extra class, which has no date of its own to change yet', () => {
    const extra = occurrence({ key: 'x:o1', originalDate: null, extra: true });
    expect(shown(sheetActions(extra, { attendance: true }, DAY))).toEqual({
      state: null,
      cancel: [],
      restore: false,
      changeReason: [],
    });
  });
});
