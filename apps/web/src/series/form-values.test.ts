import type { ScheduleGroup, Series } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import {
  blankValues,
  changedFields,
  checkCreateSeries,
  checkGroup,
  checkUpdateSeries,
  fieldMessage,
  firstProblemField,
  NEW_GROUP,
  problemsFromErrors,
  type SeriesFormValues,
  selectableGroups,
  toCreateGroup,
  toCreateSeries,
  todayIn,
  toFullUpdate,
  valuesFromSeries,
} from './form-values.ts';

// Made-up rows, shaped like the sample timetable (packages/core/.../sample-timetable.ts).
const GROUP_ID = '0199d6a0-0000-7000-8000-000000000001';
const SERIES_ID = '0199d6a0-0000-7000-8000-000000000002';
const NEW_GROUP_ID = '0199d6a0-0000-7000-8000-000000000003';
const TODAY = '2026-10-13';

const sem3: ScheduleGroup = {
  id: GROUP_ID,
  name: 'Classes · Sem 3 (sample)',
  colorToken: 'teal',
  activeFrom: '2026-07-13',
  activeTo: '2026-11-27',
  observesHolidays: true,
  attendance: true,
  attendanceThresholdPct: 75,
  attendanceTrackingFrom: null,
  archivedAt: null,
};
const archived: ScheduleGroup = {
  ...sem3,
  id: '0199d6a0-0000-7000-8000-000000000009',
  archivedAt: '2026-07-01T00:00:00Z',
};

const lab: Series = {
  id: SERIES_ID,
  groupId: GROUP_ID,
  title: 'Digital Systems Lab',
  subject: 'Digital Systems Lab',
  location: 'Lab 5',
  rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
  startDate: '2026-07-16',
  untilDate: null,
  startTime: '14:00:00',
  durationMin: 120,
  tzid: 'Asia/Kolkata',
  previousSeriesId: null,
};

/** A filled-in form for "Data Structures, Mon/Wed/Fri 08:00 in C-301". */
function filled(overrides: Partial<SeriesFormValues> = {}): SeriesFormValues {
  return {
    ...blankValues(TODAY, [sem3]),
    title: 'DS',
    subject: 'Data Structures',
    location: 'C-301',
    days: ['FR', 'MO', 'WE'],
    startTime: '08:00',
    ...overrides,
  };
}

describe('starting values', () => {
  it("is today's date in the user's zone, not the phone's", () => {
    // 20:00 UTC on the 12th is already 01:30 on the 13th in Kolkata.
    const at = Date.parse('2026-10-12T20:00:00Z');
    expect(todayIn('Asia/Kolkata', at)).toBe('2026-10-13');
    expect(todayIn('America/New_York', at)).toBe('2026-10-12');
  });

  it('picks the first group that is not archived, or "new group" when there is none', () => {
    expect(blankValues(TODAY, [archived, sem3]).groupId).toBe(GROUP_ID);
    expect(blankValues(TODAY, [archived]).groupId).toBe(NEW_GROUP);
    expect(blankValues(TODAY, []).groupId).toBe(NEW_GROUP);
  });

  it('offers archived groups only when the series already belongs to one', () => {
    expect(selectableGroups([archived, sem3])).toEqual([sem3]);
    expect(selectableGroups([archived, sem3], archived.id)).toEqual([archived, sem3]);
  });

  it('fills the form from a series, leaving the subject empty when it is the title', () => {
    expect(valuesFromSeries(lab, TODAY)).toMatchObject({
      title: 'Digital Systems Lab',
      subject: '',
      location: 'Lab 5',
      days: ['TH'],
      interval: 2,
      startTime: '14:00',
      durationMin: '120',
      untilDate: '',
    });
  });

  it('shows a daily rule as every day of every week', () => {
    const run = { ...lab, rule: { freq: 'daily' as const, interval: 1 } };
    expect(valuesFromSeries(run, TODAY)).toMatchObject({
      days: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
      interval: 1,
    });
  });
});

describe('request bodies', () => {
  it('builds a create body with the days Monday first and blanks as null', () => {
    expect(
      toCreateSeries(filled({ location: '  ' }), { series: SERIES_ID, group: GROUP_ID }),
    ).toEqual({
      id: SERIES_ID,
      groupId: GROUP_ID,
      title: 'DS',
      subject: 'Data Structures',
      location: null,
      rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] },
      startDate: TODAY,
      untilDate: null,
      startTime: '08:00',
      durationMin: 60,
    });
  });

  it('leaves the subject out of a create when the user left it empty', () => {
    const body = toCreateSeries(filled({ subject: ' ' }), { series: SERIES_ID, group: GROUP_ID });
    expect(body).not.toHaveProperty('subject');
  });

  it('builds the new group from the inline fields', () => {
    const values = filled({
      groupId: NEW_GROUP,
      newGroup: { name: 'Sem 4', colorToken: 'violet', activeFrom: '2027-01-04' },
    });
    expect(toCreateGroup(values, NEW_GROUP_ID)).toEqual({
      id: NEW_GROUP_ID,
      name: 'Sem 4',
      colorToken: 'violet',
      activeFrom: '2027-01-04',
    });
  });

  it('sends only what changed in an edit', () => {
    const initial = valuesFromSeries(lab, TODAY);
    expect(changedFields(initial, initial, GROUP_ID)).toEqual({});
    expect(
      changedFields({ ...initial, location: 'Lab 3', durationMin: '90' }, initial, GROUP_ID),
    ).toEqual({ location: 'Lab 3', durationMin: 90 });
  });

  it('sends the whole rule when the days change, and the new group id when it changes', () => {
    const initial = valuesFromSeries(lab, TODAY);
    expect(changedFields({ ...initial, days: ['TH', 'TU'] }, initial, NEW_GROUP_ID)).toEqual({
      groupId: NEW_GROUP_ID,
      rule: { freq: 'weekly', interval: 2, byDay: ['TU', 'TH'] },
    });
  });

  it('does not resend a daily rule the user did not touch', () => {
    const initial = valuesFromSeries({ ...lab, rule: { freq: 'daily', interval: 1 } }, TODAY);
    expect(changedFields({ ...initial, title: 'Lab' }, initial, GROUP_ID)).toEqual({
      title: 'Lab',
      // The subject was following the title, so it follows the new one.
      subject: 'Lab',
    });
  });
});

describe('checking with the shared schemas', () => {
  const ids = { series: SERIES_ID, group: GROUP_ID };

  it('passes a complete form', () => {
    expect(checkCreateSeries(toCreateSeries(filled(), ids))).toEqual({ fields: {}, other: [] });
  });

  it('puts each schema message on its field, with the label in front', () => {
    const values = filled({
      title: '',
      days: [],
      durationMin: '',
      untilDate: '2026-10-01',
    });
    expect(checkCreateSeries(toCreateSeries(values, ids)).fields).toEqual({
      title: 'Title must not be empty',
      days: 'Pick at least one day',
      durationMin: 'Duration in minutes must be a number',
      untilDate: 'Last day must be on or after the first day',
    });
  });

  it('words the checks the schema leaves to zod', () => {
    const tooLong = checkCreateSeries(
      toCreateSeries(filled({ title: 'x'.repeat(81), durationMin: '0' }), ids),
    );
    expect(tooLong.fields).toEqual({
      title: 'Title must be at most 80 characters',
      durationMin: 'Duration in minutes must be at least 1',
    });
    const fraction = checkCreateSeries(toCreateSeries(filled({ durationMin: '1.5' }), ids));
    expect(fraction.fields.durationMin).toBe('Duration in minutes must be a whole number');
  });

  it('checks an edit as a whole, so the date order is checked too', () => {
    const values = filled({ startDate: '2026-10-13', untilDate: '2026-10-12' });
    expect(checkUpdateSeries(toFullUpdate(values, GROUP_ID)).fields).toEqual({
      untilDate: 'Last day must be on or after the first day',
    });
  });

  it('checks the new group with its own schema', () => {
    const values = filled({
      groupId: NEW_GROUP,
      newGroup: { name: ' ', colorToken: 'blue', activeFrom: '' },
    });
    expect(checkGroup(toCreateGroup(values, NEW_GROUP_ID)).fields).toEqual({
      groupName: 'Group name must not be empty',
      groupActiveFrom: 'Group starts on must be a date like 2026-10-13',
    });
  });
});

describe("the server's 422", () => {
  it('maps body paths to fields, deeper paths to their start, the rest to "other"', () => {
    const problems = problemsFromErrors(
      [
        { path: 'rule.byDay.0', message: 'Invalid option' },
        { path: 'startTime', message: 'must be a time like 09:30' },
        { path: 'startTime', message: 'a second message is dropped' },
        { path: 'tzid', message: 'must be a time zone name like Asia/Kolkata' },
      ],
      'series',
    );
    expect(problems).toEqual({
      fields: { days: 'Invalid option', startTime: 'Starts at must be a time like 09:30' },
      other: ['tzid: must be a time zone name like Asia/Kolkata'],
    });
    expect(firstProblemField(problems)).toBe('days');
  });

  it('maps a group body path to the group fields', () => {
    expect(problemsFromErrors([{ path: 'name', message: 'must not be empty' }], 'group')).toEqual({
      fields: { groupName: 'Group name must not be empty' },
      other: [],
    });
  });

  it('capitalises a message that is not about the field name', () => {
    expect(fieldMessage('days', 'pick at least one day')).toBe('Pick at least one day');
  });
});
