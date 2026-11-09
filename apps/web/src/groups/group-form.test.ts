import type { ScheduleGroup } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import {
  blankGroupValues,
  checkGroupForm,
  firstGroupProblem,
  groupChanges,
  groupCreateBody,
  groupProblemsFromErrors,
  valuesFromGroup,
} from './group-form.ts';

// Made-up rows, like the sample timetable's.
const GROUP_ID = '0199d6a0-0000-7000-8000-000000000011';

const evening: ScheduleGroup = {
  id: GROUP_ID,
  name: 'Evening classes',
  colorToken: 'teal',
  untilDate: '2026-12-18',
  observesHolidays: true,
  attendance: false,
  attendanceThresholdPct: 75,
  attendanceTrackingFrom: null,
};

describe('a new group', () => {
  it('starts with no name, the default colour, attendance on and no last day', () => {
    expect(blankGroupValues()).toEqual({
      name: '',
      colorToken: 'blue',
      attendance: true,
      untilDate: '',
    });
  });

  it('is created with what was typed, and an empty last day as none', () => {
    const values = { ...blankGroupValues(), name: 'Evening classes', colorToken: 'teal' as const };
    expect(groupCreateBody(values, GROUP_ID)).toEqual({
      id: GROUP_ID,
      name: 'Evening classes',
      colorToken: 'teal',
      attendance: true,
      untilDate: null,
    });
    expect(groupCreateBody({ ...values, untilDate: '2026-12-18' }, GROUP_ID).untilDate).toBe(
      '2026-12-18',
    );
  });
});

describe('an edited group', () => {
  it('starts from the group as it is', () => {
    expect(valuesFromGroup(evening)).toEqual({
      name: 'Evening classes',
      colorToken: 'teal',
      attendance: false,
      untilDate: '2026-12-18',
    });
    expect(valuesFromGroup({ ...evening, untilDate: null }).untilDate).toBe('');
  });

  it('sends only what changed, so a change made elsewhere to another field survives', () => {
    const initial = valuesFromGroup(evening);
    expect(groupChanges(initial, initial)).toEqual({});
    expect(
      groupChanges(
        { ...initial, name: 'Pottery evenings', untilDate: '', attendance: true },
        initial,
      ),
    ).toEqual({ name: 'Pottery evenings', untilDate: null, attendance: true });
  });
});

describe('checking a group before it is sent', () => {
  it("names each problem with the API's own schema, in words the screen uses", () => {
    expect(checkGroupForm({ ...blankGroupValues(), name: '   ' }).fields).toEqual({
      name: 'Name must not be empty',
    });
    expect(checkGroupForm({ ...blankGroupValues(), name: 'x'.repeat(81) }).fields).toEqual({
      name: 'Name must be at most 80 characters',
    });
    expect(checkGroupForm({ ...valuesFromGroup(evening), untilDate: '2026-02-30' }).fields).toEqual(
      {
        untilDate: 'Last day is not a real date',
      },
    );
    expect(checkGroupForm(valuesFromGroup(evening))).toEqual({ fields: {}, other: [] });
  });

  it("puts the server's 422 on the field it names, and the rest above the form", () => {
    const problems = groupProblemsFromErrors([
      { path: 'untilDate', message: 'is not a real date' },
      { path: 'name', message: 'must not be empty' },
      { path: 'observesHolidays', message: 'expected boolean' },
    ]);
    expect(problems).toEqual({
      fields: { untilDate: 'Last day is not a real date', name: 'Name must not be empty' },
      other: ['observesHolidays: expected boolean'],
    });
    // The focus goes to the first one on screen: the name, above the last day.
    expect(firstGroupProblem(problems)).toBe('name');
  });
});
