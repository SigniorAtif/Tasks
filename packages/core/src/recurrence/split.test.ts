import { describe, expect, it } from 'vitest';
import { cancel, extra, series } from '../test/builders.ts';
import type { Rule } from '../types.ts';
import { expandDates } from './dates.ts';
import { splitSeries } from './split.ts';

const fortnightlyMonday: Rule = { freq: 'weekly', interval: 2, byDay: ['MO'] };
const MWF: Rule = { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] };

describe('splitSeries', () => {
  it('S1: with no changes, the new half keeps the phase of "every 2 weeks"', () => {
    const s = series({ rule: fortnightlyMonday, startDate: '2026-10-05' });
    const plan = splitSeries({
      series: s,
      at: '2026-10-13',
      changes: {},
      overrides: [],
      newId: 'n',
    });
    expect(plan.kind).toBe('split');
    if (plan.kind !== 'split') return;
    expect(plan.old.untilDate).toBe('2026-10-12');
    // Starting the new half on the split date itself (a Tuesday) would flip the phase to
    // 10-26 and 11-09. Starting it on its first real occurrence keeps it on 10-19 and 11-02.
    expect(plan.next.startDate).toBe('2026-10-19');
    expect(expandDates(plan.next, { from: '2026-10-13', to: '2026-11-08' })).toEqual([
      '2026-10-19',
      '2026-11-02',
    ]);
    expect(plan.next).toMatchObject({ id: 'n', previousSeriesId: 's', rule: fortnightlyMonday });
  });

  it('S2: a time change moves later overrides to the new half and leaves earlier ones', () => {
    const s = series({ rule: MWF });
    const before = cancel('s', '2026-10-14', 'skipped');
    const after = cancel('s', '2026-10-21', 'not_held');
    const plan = splitSeries({
      series: s,
      at: '2026-10-19',
      changes: { startTime: '11:00' },
      overrides: [before, after],
      newId: 'n',
    });
    expect(plan).toMatchObject({
      kind: 'split',
      old: { untilDate: '2026-10-18', startTime: '10:00' },
      next: { startDate: '2026-10-19', startTime: '11:00' },
      rekeyed: [after.id],
      orphaned: [],
    });
  });

  it('S3: a split after the series has ended never extends it', () => {
    const s = series({ untilDate: '2026-11-27' });
    const plan = splitSeries({
      series: s,
      at: '2026-12-10',
      changes: {},
      overrides: [],
      newId: 'n',
    });
    expect(plan).toEqual({
      kind: 'end_only',
      series: { ...s, untilDate: '2026-11-27' },
      orphaned: [],
    });
  });

  it('S4: a split on or before the start updates the series in place', () => {
    const s = series({ startDate: '2026-10-05' });
    const plan = splitSeries({
      series: s,
      at: '2026-10-05',
      changes: { startTime: '11:00' },
      overrides: [],
      newId: 'n',
    });
    expect(plan).toEqual({ kind: 'in_place', series: { ...s, startTime: '11:00' }, orphaned: [] });
  });

  it('an in-place rule change reports the overrides it orphans', () => {
    const s = series({ startDate: '2026-10-05' });
    const monday = cancel('s', '2026-10-12', 'skipped');
    const plan = splitSeries({
      series: s,
      at: '2026-10-01',
      changes: { rule: { freq: 'weekly', interval: 1, byDay: ['TU', 'TH'] } },
      overrides: [monday],
      newId: 'n',
    });
    expect(plan).toMatchObject({ kind: 'in_place', orphaned: [monday.id] });
  });

  it('S6: moving Mon/Wed/Fri to Tue/Thu orphans a later Monday cancel, and the UI can ask first', () => {
    const s = series({ rule: MWF });
    const monday = cancel('s', '2026-10-26', 'skipped');
    const plan = splitSeries({
      series: s,
      at: '2026-10-19',
      changes: { rule: { freq: 'weekly', interval: 1, byDay: ['TU', 'TH'] } },
      overrides: [monday],
      newId: 'n',
    });
    expect(plan).toMatchObject({ kind: 'split', rekeyed: [], orphaned: [monday.id] });
  });

  it("a new rule's phase starts at its first matching day on or after the split", () => {
    // Split on Friday 23 Oct to "every 2 weeks on Thursday": first 29 Oct, then 12 Nov.
    const s = series({ rule: MWF });
    const plan = splitSeries({
      series: s,
      at: '2026-10-23',
      changes: { rule: { freq: 'weekly', interval: 2, byDay: ['TH'] } },
      overrides: [],
      newId: 'n',
    });
    expect(plan.kind === 'split' && plan.next.startDate).toBe('2026-10-29');
    if (plan.kind !== 'split') return;
    expect(expandDates(plan.next, { from: '2026-10-23', to: '2026-11-15' })).toEqual([
      '2026-10-29',
      '2026-11-12',
    ]);
  });

  it('the same rule written differently counts as unchanged, so the phase is kept', () => {
    const s = series({ rule: fortnightlyMonday, startDate: '2026-10-05' });
    const plan = splitSeries({
      series: s,
      at: '2026-10-13',
      changes: { rule: { freq: 'weekly', interval: 2, byDay: ['MO', 'MO'] } },
      overrides: [],
      newId: 'n',
    });
    expect(plan.kind === 'split' && plan.next.startDate).toBe('2026-10-19');
  });

  it('a new rule whose first day is past the until date just ends the series', () => {
    const s = series({ rule: MWF, untilDate: '2026-10-20' });
    const plan = splitSeries({
      series: s,
      at: '2026-10-19',
      changes: { rule: { freq: 'weekly', interval: 1, byDay: ['SA'] } },
      overrides: [cancel('s', '2026-10-19', 'skipped')],
      newId: 'n',
    });
    expect(plan).toMatchObject({
      kind: 'end_only',
      series: { untilDate: '2026-10-18' },
      orphaned: ['o-s-2026-10-19'],
    });
  });

  it('only moves its own "modified" overrides: extras and other series stay where they are', () => {
    const s = series({ rule: MWF });
    const plan = splitSeries({
      series: s,
      at: '2026-10-19',
      changes: { startTime: '11:00' },
      overrides: [extra('m1', 's', '2026-10-24', '09:00'), cancel('other', '2026-10-21')],
      newId: 'n',
    });
    expect(plan).toMatchObject({ kind: 'split', rekeyed: [], orphaned: [] });
  });

  it('rejects an invalid new rule', () => {
    const s = series({ rule: MWF });
    expect(() =>
      splitSeries({
        series: s,
        at: '2026-10-19',
        changes: { rule: { freq: 'weekly', interval: 1, byDay: [] } },
        overrides: [],
        newId: 'n',
      }),
    ).toThrow(RangeError);
  });
});
