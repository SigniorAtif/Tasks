import { describe, expect, it } from 'vitest';
import { cancel, dayOff, extra, group, modified, move, series } from '../test/builders.ts';
import type { Occurrence } from '../types.ts';
import { type ExpandInput, expand, findOrphans, occurrenceOn, stopShowing } from './expand.ts';

// A Mon/Wed/Fri 10:00 class in Asia/Kolkata (UTC+05:30), starting Mon 5 Oct 2026.
const dbms = series();
const classes = group();

function run(fields: Partial<ExpandInput> & Pick<ExpandInput, 'window'>): Occurrence[] {
  return expand({ groups: [classes], series: [dbms], overrides: [], dayExceptions: [], ...fields });
}
const byKey = (occs: Occurrence[], key: string) => occs.find((o) => o.key === key);
const keys = (occs: Occurrence[]) => occs.map((o) => o.key);

const firstWeek = { from: '2026-10-05', to: '2026-10-11' };

describe('plain expansion', () => {
  it('turns wall-clock times into UTC instants and copies the series fields', () => {
    const [first] = run({ window: firstWeek });
    expect(first).toEqual({
      key: 's:2026-10-05',
      seriesId: 's',
      groupId: 'g',
      title: 'DBMS',
      subject: 'DBMS',
      location: null,
      originalDate: '2026-10-05',
      date: '2026-10-05',
      start: '2026-10-05T04:30:00Z',
      end: '2026-10-05T05:30:00Z',
      tzid: 'Asia/Kolkata',
      status: 'scheduled',
      cancelReason: null,
      cancelOrigin: null,
      holidayLabel: null,
      moved: false,
      extra: false,
      dstShifted: false,
      confirmedAt: null,
      note: null,
    } satisfies Occurrence);
  });

  it('sorts by start time across series, and by key when two start together', () => {
    const early = series({ id: 'a', startTime: '09:00' });
    const sameTimeB = series({ id: 'c' });
    const sameTimeA = series({ id: 'b' });
    const occs = run({
      series: [sameTimeB, early, sameTimeA],
      window: { from: '2026-10-05', to: '2026-10-05' },
    });
    expect(keys(occs)).toEqual(['a:2026-10-05', 'b:2026-10-05', 'c:2026-10-05']);
  });

  it('a one-day window works', () => {
    expect(keys(run({ window: { from: '2026-10-07', to: '2026-10-07' } }))).toEqual([
      's:2026-10-07',
    ]);
  });

  it("archiving (the group's last day) stops later occurrences but keeps past ones", () => {
    const archived = group({ untilDate: '2026-10-07' });
    const occs = run({ groups: [archived], window: firstWeek });
    expect(keys(occs)).toEqual(['s:2026-10-05', 's:2026-10-07']);
  });
});

describe('groups are folders: no first day', () => {
  it('never hides a series before its group existed: "Run, since 1 Oct" in a group made on 15 Oct', () => {
    const health = group({ id: 'health', name: 'Health' });
    const runDaily = series({
      id: 'run',
      groupId: 'health',
      title: 'Run',
      rule: { freq: 'daily', interval: 1 },
      startDate: '2025-10-01',
    });
    const occs = run({
      groups: [health],
      series: [runDaily],
      window: { from: '2025-10-01', to: '2025-10-03' },
    });
    expect(keys(occs)).toEqual(['run:2025-10-01', 'run:2025-10-02', 'run:2025-10-03']);
  });
});

describe('overrides', () => {
  it("O1: a cancelled occurrence is still returned, with the user's reason", () => {
    const occ = byKey(
      run({ overrides: [cancel('s', '2026-10-07', 'not_held')], window: firstWeek }),
      's:2026-10-07',
    );
    expect(occ).toMatchObject({
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'user',
    });
  });

  it('a cancel in a group without attendance has no reason', () => {
    const occ = byKey(
      run({ overrides: [cancel('s', '2026-10-07')], window: firstWeek }),
      's:2026-10-07',
    );
    expect(occ).toMatchObject({ status: 'cancelled', cancelReason: null, cancelOrigin: 'user' });
  });

  it('O2: moved out of the window, it disappears from the window', () => {
    const occs = run({
      overrides: [move('s', '2026-10-09', '2026-10-12', '14:00')],
      window: firstWeek,
    });
    expect(byKey(occs, 's:2026-10-09')).toBeUndefined();
  });

  it('O3: and appears in the window it was moved into, keeping its key', () => {
    const occs = run({
      overrides: [move('s', '2026-10-09', '2026-10-10', '14:00')],
      window: { from: '2026-10-10', to: '2026-10-11' },
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]).toMatchObject({
      key: 's:2026-10-09',
      originalDate: '2026-10-09',
      date: '2026-10-10',
      start: '2026-10-10T08:30:00Z',
      moved: true,
    });
  });

  it('O4: moved into the window from a date far outside it', () => {
    const occs = run({ overrides: [move('s', '2026-10-19', '2026-10-10')], window: firstWeek });
    expect(byKey(occs, 's:2026-10-19')).toMatchObject({
      date: '2026-10-10',
      start: '2026-10-10T04:30:00Z',
    });
  });

  it("a moved-in override is ignored when its original date isn't a real occurrence", () => {
    // 10-20 is a Tuesday; DBMS doesn't happen on Tuesdays, so this override is an orphan.
    const occs = run({ overrides: [move('s', '2026-10-20', '2026-10-10')], window: firstWeek });
    expect(byKey(occs, 's:2026-10-20')).toBeUndefined();
  });

  it('a time-only move keeps the date', () => {
    const occ = byKey(
      run({ overrides: [move('s', '2026-10-07', null, '11:30')], window: firstWeek }),
      's:2026-10-07',
    );
    expect(occ).toMatchObject({ date: '2026-10-07', start: '2026-10-07T06:00:00Z', moved: true });
  });

  it('a move to the same date and time is not reported as moved', () => {
    const occ = byKey(
      run({ overrides: [move('s', '2026-10-07', '2026-10-07', '10:00')], window: firstWeek }),
      's:2026-10-07',
    );
    expect(occ?.moved).toBe(false);
  });

  it('O5: an override only fills the fields it sets; the rest follows later series changes', () => {
    const longer = modified('s', '2026-10-07', { durationMin: 90 });
    const occ = byKey(
      run({ series: [series({ startTime: '11:00' })], overrides: [longer], window: firstWeek }),
      's:2026-10-07',
    );
    expect(occ).toMatchObject({
      start: '2026-10-07T05:30:00Z',
      end: '2026-10-07T07:00:00Z',
      moved: false,
    });
  });

  it('O6: an explicitly placed occurrence stays put when the series time changes', () => {
    const placed = move('s', '2026-10-07', null, '14:00');
    const occ = byKey(
      run({ series: [series({ startTime: '11:00' })], overrides: [placed], window: firstWeek }),
      's:2026-10-07',
    );
    expect(occ?.start).toBe('2026-10-07T08:30:00Z');
  });

  it('O11: an override with every field back to "inherit" is the plain occurrence', () => {
    const undone = modified('s', '2026-10-07');
    expect(run({ overrides: [undone], window: firstWeek })).toEqual(run({ window: firstWeek }));
  });

  it('carries the attendance confirmation through', () => {
    const confirmed = modified('s', '2026-10-07', { confirmedAt: '2026-10-07T16:00:00Z' });
    const occ = byKey(run({ overrides: [confirmed], window: firstWeek }), 's:2026-10-07');
    expect(occ?.confirmedAt).toBe('2026-10-07T16:00:00Z');
  });

  it('carries a note through, and the note changes nothing else', () => {
    const noted = modified('s', '2026-10-07', { note: 'Bring the lab manual' });
    const occs = run({ overrides: [noted], window: firstWeek });
    expect(byKey(occs, 's:2026-10-07')?.note).toBe('Bring the lab manual');
    const plain = run({ window: firstWeek });
    expect(occs.map((o) => ({ ...o, note: null }))).toEqual(plain);
  });

  it('keeps the note on a class moved in from outside the window', () => {
    // Fri 16 Oct moved back to Sat 10 Oct: pass 2 builds it.
    const movedIn = modified('s', '2026-10-16', {
      newDate: '2026-10-10',
      note: 'Make-up for Friday',
    });
    const occ = byKey(run({ overrides: [movedIn], window: firstWeek }), 's:2026-10-16');
    expect(occ).toMatchObject({ date: '2026-10-10', note: 'Make-up for Friday' });
  });

  it("ignores overrides for series that weren't passed in", () => {
    const stray = cancel('other', '2026-10-07', 'skipped');
    const strayExtra = extra('x1', 'other', '2026-10-10', '09:00');
    expect(run({ overrides: [stray, strayExtra], window: firstWeek })).toEqual(
      run({ window: firstWeek }),
    );
  });
});

describe('extras', () => {
  it('O10: a make-up class gets its own key and keeps the series fields', () => {
    const makeUp = extra('m1', 's', '2026-10-10', '09:00');
    const occ = byKey(run({ overrides: [makeUp], window: firstWeek }), 'x:m1');
    expect(occ).toMatchObject({
      seriesId: 's',
      title: 'DBMS',
      originalDate: null,
      date: '2026-10-10',
      start: '2026-10-10T03:30:00Z',
      end: '2026-10-10T04:30:00Z',
      status: 'scheduled',
      extra: true,
      moved: false,
    });
  });

  it('can be cancelled, and can have its own duration and note', () => {
    const makeUp = extra('m1', 's', '2026-10-10', '09:00', {
      status: 'cancelled',
      cancelReason: 'not_held',
      durationMin: 120,
      note: 'Room changed to C-105',
    });
    const occ = byKey(run({ overrides: [makeUp], window: firstWeek }), 'x:m1');
    expect(occ).toMatchObject({
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'user',
      end: '2026-10-10T05:30:00Z',
      note: 'Room changed to C-105',
    });
  });

  it('is ignored by days off: it is exactly what the user placed', () => {
    const makeUp = extra('m1', 's', '2026-12-05', '09:00');
    const occs = run({
      overrides: [makeUp],
      dayExceptions: [dayOff('2026-12-05')],
      window: { from: '2026-12-05', to: '2026-12-05' },
    });
    expect(keys(occs)).toEqual(['x:m1']);
    expect(occs[0]?.status).toBe('scheduled');
  });

  it("shows up to its group's last day, and hides after it", () => {
    const ended = group({ untilDate: '2026-11-27' });
    const onLastDay = extra('m1', 's', '2026-11-27', '09:00');
    const afterIt = extra('m2', 's', '2026-11-28', '09:00');
    const occs = run({
      groups: [ended],
      overrides: [onLastDay, afterIt],
      window: { from: '2026-11-23', to: '2026-11-29' },
    });
    expect(keys(occs).filter((k) => k.startsWith('x:'))).toEqual(['x:m1']);
  });

  it('is left out when it falls outside the window', () => {
    const makeUp = extra('m1', 's', '2026-10-20', '09:00');
    expect(byKey(run({ overrides: [makeUp], window: firstWeek }), 'x:m1')).toBeUndefined();
  });
});

describe('day exceptions (holidays and days off)', () => {
  // Tue 20 Oct 2026 is the example holiday; DBMS runs Tue/Thu in these tests.
  const tueThu = series({ rule: { freq: 'weekly', interval: 1, byDay: ['TU', 'TH'] } });
  const run2 = series({
    id: 'run',
    groupId: 'health',
    title: 'Evening run',
    rule: { freq: 'daily', interval: 1 },
  });
  const health = group({ id: 'health', observesHolidays: false, attendance: false });
  const holidayWeek = { from: '2026-10-19', to: '2026-10-25' };
  const dussehra = dayOff('2026-10-20', 'not_held', 'Dussehra');

  const runWeek = (fields: Partial<ExpandInput> = {}) =>
    expand({
      groups: [classes, health],
      series: [tueThu, run2],
      overrides: [],
      dayExceptions: [dussehra],
      window: holidayWeek,
      ...fields,
    });

  it('H1: cancels classes in groups that observe holidays, and leaves the others alone', () => {
    const occs = runWeek();
    expect(byKey(occs, 's:2026-10-20')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'holiday',
      holidayLabel: 'Dussehra',
    });
    expect(byKey(occs, 'run:2026-10-20')?.status).toBe('scheduled');
    expect(byKey(occs, 's:2026-10-22')?.status).toBe('scheduled');
  });

  it('H2: an explicit "it\'s on" beats the holiday', () => {
    const held = modified('s', '2026-10-20', { status: 'scheduled' });
    expect(byKey(runWeek({ overrides: [held] }), 's:2026-10-20')).toMatchObject({
      status: 'scheduled',
      cancelOrigin: null,
      holidayLabel: null,
    });
  });

  it("an explicit cancel beats the holiday, keeping the user's reason", () => {
    const skipped = cancel('s', '2026-10-20', 'skipped');
    expect(byKey(runWeek({ overrides: [skipped] }), 's:2026-10-20')).toMatchObject({
      cancelReason: 'skipped',
      cancelOrigin: 'user',
      holidayLabel: null,
    });
  });

  it('H3: removing the holiday brings the class back', () => {
    expect(byKey(runWeek({ dayExceptions: [] }), 's:2026-10-20')?.status).toBe('scheduled');
  });

  it('H5: a class moved onto a holiday stays where the user put it', () => {
    const onto = move('s', '2026-10-22', '2026-10-20');
    expect(byKey(runWeek({ overrides: [onto] }), 's:2026-10-22')).toMatchObject({
      date: '2026-10-20',
      status: 'scheduled',
    });
  });

  it('a class moved off a holiday is not cancelled by it', () => {
    const off = move('s', '2026-10-20', '2026-10-24');
    expect(byKey(runWeek({ overrides: [off] }), 's:2026-10-20')).toMatchObject({
      date: '2026-10-24',
      status: 'scheduled',
    });
  });

  it('an override that only changes the duration still lets the holiday apply', () => {
    const longer = modified('s', '2026-10-20', { durationMin: 90 });
    expect(byKey(runWeek({ overrides: [longer] }), 's:2026-10-20')?.status).toBe('cancelled');
  });

  it('a note alone still lets the holiday apply, and the note stays visible', () => {
    const noted = modified('s', '2026-10-20', { note: 'Submit the assignment anyway' });
    expect(byKey(runWeek({ overrides: [noted] }), 's:2026-10-20')).toMatchObject({
      status: 'cancelled',
      cancelOrigin: 'holiday',
      note: 'Submit the assignment anyway',
    });
  });

  it('"I\'m away" days cancel as skipped', () => {
    const away = dayOff('2026-10-22', 'skipped', 'Away');
    expect(byKey(runWeek({ dayExceptions: [away] }), 's:2026-10-22')).toMatchObject({
      cancelReason: 'skipped',
      cancelOrigin: 'holiday',
      holidayLabel: 'Away',
    });
  });

  it('when a day has both, "not held" wins, whatever the order', () => {
    const away = dayOff('2026-10-20', 'skipped', 'Away');
    for (const dayExceptions of [
      [away, dussehra],
      [dussehra, away],
    ]) {
      expect(byKey(runWeek({ dayExceptions }), 's:2026-10-20')?.cancelReason).toBe('not_held');
    }
  });

  it('H6: a holiday also covers series created after it', () => {
    const later = series({
      id: 'new',
      rule: { freq: 'weekly', interval: 1, byDay: ['TU'] },
      startDate: '2026-10-15',
    });
    expect(byKey(runWeek({ series: [later] }), 'new:2026-10-20')?.status).toBe('cancelled');
  });
});

describe('bad input fails loudly', () => {
  it('rejects a window that ends before it starts', () => {
    expect(() => run({ window: { from: '2026-10-11', to: '2026-10-05' } })).toThrow(RangeError);
  });

  it("rejects a series whose group wasn't passed in", () => {
    expect(() => run({ groups: [], window: firstWeek })).toThrow(/group g/);
  });

  it('rejects an unknown time zone', () => {
    expect(() => run({ series: [series({ tzid: 'IST' })], window: firstWeek })).toThrow(RangeError);
  });

  it('rejects a raw offset, which Temporal would accept but which never follows daylight saving', () => {
    for (const tzid of ['+05:30', '-04:00']) {
      expect(() => run({ series: [series({ tzid })], window: firstWeek })).toThrow(/IANA/);
    }
  });
});

describe('occurrenceOn: one occurrence by its original date', () => {
  const one = (originalDate: string, fields: Partial<Parameters<typeof occurrenceOn>[0]> = {}) =>
    occurrenceOn(
      { series: dbms, group: classes, override: undefined, dayExceptions: [], ...fields },
      originalDate,
    );

  it('computes exactly what expand() shows, wherever the occurrence was moved to', () => {
    const skipped = cancel('s', '2026-10-07', 'skipped');
    const moved = move('s', '2026-10-09', '2026-10-10', '12:00');
    const holiday = dayOff('2026-10-05');
    const week = run({ overrides: [skipped, moved], dayExceptions: [holiday], window: firstWeek });

    expect(one('2026-10-05', { dayExceptions: [holiday] })).toEqual(byKey(week, 's:2026-10-05'));
    expect(one('2026-10-07', { override: skipped })).toEqual(byKey(week, 's:2026-10-07'));
    expect(one('2026-10-09', { override: moved })).toEqual(byKey(week, 's:2026-10-09'));
    expect(one('2026-10-09', { override: moved })?.date).toBe('2026-10-10');
  });

  it("is undefined for a date the series never generates: off its rule, before its first day, after its group's last day", () => {
    expect(one('2026-10-06')).toBeUndefined();
    expect(one('2026-10-02')).toBeUndefined();
    expect(one('2026-10-09', { group: group({ untilDate: '2026-10-07' }) })).toBeUndefined();
  });

  it('rejects a raw offset, like expand()', () => {
    expect(() => one('2026-10-05', { series: series({ tzid: '+05:30' }) })).toThrow(RangeError);
  });
});

describe('last days hide changes, never erase them', () => {
  // DBMS is skipped on Mon 30 Nov; the last day then moves to Fri 27 Nov and back out.
  const skipped = cancel('s', '2026-11-30', 'skipped');
  const week = { from: '2026-11-30', to: '2026-12-06' };

  it("a cancel after the group's last day is dormant, and comes back when the date moves later", () => {
    const ended = run({
      groups: [group({ untilDate: '2026-11-27' })],
      overrides: [skipped],
      window: week,
    });
    expect(ended).toEqual([]);

    const later = run({
      groups: [group({ untilDate: '2026-12-04' })],
      overrides: [skipped],
      window: week,
    });
    expect(byKey(later, 's:2026-11-30')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'skipped',
    });
  });

  it("the same with the series' own last day", () => {
    const ended = run({
      series: [series({ untilDate: '2026-11-27' })],
      overrides: [skipped],
      window: week,
    });
    expect(ended).toEqual([]);

    const later = run({
      series: [series({ untilDate: '2026-12-04' })],
      overrides: [skipped],
      window: week,
    });
    expect(byKey(later, 's:2026-11-30')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'skipped',
    });
  });
});

describe('stopShowing: the changes a new last day would hide', () => {
  // Cancels on Wed 25 Nov and Mon 30 Nov, a make-up class on Tue 1 Dec.
  const before = cancel('s', '2026-11-25', 'not_held');
  const after = cancel('s', '2026-11-30', 'skipped');
  const makeUp = extra('m1', 's', '2026-12-01', '09:00');
  const overrides = [before, after, makeUp];

  it("a group's last day hides the cancels and extras after it", () => {
    const current = { groups: [classes], series: [dbms] };
    const proposed = { groups: [group({ untilDate: '2026-11-27' })], series: [dbms] };
    expect(stopShowing(overrides, current, proposed)).toEqual([after, makeUp]);
  });

  it("a series' last day hides its cancels, but an extra shows where it was placed", () => {
    const current = { groups: [classes], series: [dbms] };
    const proposed = { groups: [classes], series: [series({ untilDate: '2026-11-27' })] };
    expect(stopShowing(overrides, current, proposed)).toEqual([after]);
  });

  it('leaves out changes already hidden, so a later last day hides nothing', () => {
    const endsFriday = { groups: [group({ untilDate: '2026-11-27' })], series: [dbms] };
    const endsMonday = { groups: [group({ untilDate: '2026-11-23' })], series: [dbms] };
    const endsInDecember = { groups: [group({ untilDate: '2026-12-31' })], series: [dbms] };
    expect(stopShowing(overrides, endsFriday, endsMonday)).toEqual([before]);
    expect(stopShowing(overrides, endsFriday, endsInDecember)).toEqual([]);
  });

  it('never counts an orphan: a change on a date the rule no longer makes', () => {
    const tuesday = cancel('s', '2026-12-01', 'skipped');
    const current = { groups: [classes], series: [dbms] };
    const proposed = { groups: [group({ untilDate: '2026-11-27' })], series: [dbms] };
    expect(stopShowing([tuesday], current, proposed)).toEqual([]);
  });
});

describe('findOrphans', () => {
  it('O8: lists overrides whose date the series no longer generates', () => {
    const tuesdays = series({ rule: { freq: 'weekly', interval: 1, byDay: ['TU'] } });
    const onMonday = cancel('s', '2026-10-12', 'skipped');
    const onTuesday = cancel('s', '2026-10-13', 'skipped');
    const makeUp = extra('m1', 's', '2026-10-17', '09:00');
    const stray = cancel('gone', '2026-10-12');
    expect(findOrphans([tuesdays], [onMonday, onTuesday, makeUp, stray])).toEqual([onMonday]);
  });

  it("ignores the group's last day: an override after it is dormant, not orphaned", () => {
    expect(findOrphans([dbms], [cancel('s', '2027-03-01', 'skipped')])).toEqual([]);
  });
});
