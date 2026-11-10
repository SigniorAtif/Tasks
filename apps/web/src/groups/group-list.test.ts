import type { ScheduleGroup } from '@tasks/core';
import { describe, expect, it } from 'vitest';
import { groupSections, groupSummary } from './group-list.ts';

const TODAY = '2026-11-28';

function group(name: string, untilDate: string | null = null, attendance = true): ScheduleGroup {
  return {
    id: name,
    name,
    colorToken: 'blue',
    untilDate,
    observesHolidays: true,
    attendance,
    attendanceThresholdPct: 75,
    attendanceTrackingFrom: null,
  };
}

const names = (groups: readonly ScheduleGroup[]) => groups.map((g) => g.name);

describe('the Groups screen list', () => {
  it('puts active groups first and archived ones apart, each sorted by name', () => {
    const { active, archived } = groupSections(
      [
        group('health'),
        group('Classes · Sem 3', '2026-04-30'),
        group('Clubs', TODAY),
        group('Classes · Sem 2', '2025-11-27'),
        group('Art'),
      ],
      TODAY,
    );
    // A last day of today is still active: it archives tomorrow.
    expect(names(active)).toEqual(['Art', 'Clubs', 'health']);
    expect(names(archived)).toEqual(['Classes · Sem 2', 'Classes · Sem 3']);
  });

  it('sorts numbers in names the way people count, so Sem 10 comes after Sem 9', () => {
    const { active } = groupSections(
      [group('Sem 10'), group('Sem 9'), group('sem 1'), group('Sem 2')],
      TODAY,
    );
    expect(names(active)).toEqual(['sem 1', 'Sem 2', 'Sem 9', 'Sem 10']);
  });
});

describe("a group's line under its name", () => {
  it('says whether it counts attendance and when it ends, or ended', () => {
    expect(groupSummary(group('Evening classes', '2026-12-18'), TODAY)).toBe(
      'Counts attendance · Last day 18 Dec 2026',
    );
    expect(groupSummary(group('Pottery', '2026-04-30', false), TODAY)).toBe('Ended 30 Apr 2026');
    expect(groupSummary(group('Pottery', null, false), TODAY)).toBe('');
  });
});
