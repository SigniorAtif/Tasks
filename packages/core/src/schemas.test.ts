// The request schemas decide what the API accepts and what the series form lets
// through, so each rule gets an example that passes and one that fails.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  calendarQuerySchema,
  createGroupSchema,
  createSeriesSchema,
  ianaZoneSchema,
  isoDateSchema,
  ruleSchema,
  updateGroupSchema,
  updateSeriesSchema,
  wallTimeSchema,
} from './schemas.ts';

const ID = '0199e0a8-7a2b-7c3d-8e4f-0123456789ab';
const GROUP_ID = '0199e0a8-0000-7000-8000-000000000001';

/** The paths of the fields that failed, or `[]` when the input is accepted. */
function failedPaths(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('dates, times and zones', () => {
  it('accepts real ISO dates only', () => {
    expect(isoDateSchema.safeParse('2026-10-13').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(isoDateSchema.safeParse('13/10/2026').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-10-13T10:00').success).toBe(false);
  });

  it('accepts HH:MM on a 24-hour clock', () => {
    expect(wallTimeSchema.safeParse('09:30').success).toBe(true);
    expect(wallTimeSchema.safeParse('23:59').success).toBe(true);
    expect(wallTimeSchema.safeParse('24:00').success).toBe(false);
    expect(wallTimeSchema.safeParse('9:30').success).toBe(false);
    expect(wallTimeSchema.safeParse('09:30:00').success).toBe(false);
  });

  it('accepts IANA zone names in their canonical spelling, and refuses offsets and abbreviations', () => {
    expect(ianaZoneSchema.parse('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(ianaZoneSchema.parse('asia/kolkata')).toBe('Asia/Kolkata');
    expect(ianaZoneSchema.parse('America/New_York')).toBe('America/New_York');
    expect(ianaZoneSchema.safeParse('IST').success).toBe(false);
    expect(ianaZoneSchema.safeParse('+05:30').success).toBe(false);
    expect(ianaZoneSchema.safeParse('Mars/Olympus_Mons').success).toBe(false);
  });
});

describe('rules', () => {
  it('stores weekly days Monday first, each once', () => {
    expect(ruleSchema.parse({ freq: 'weekly', interval: 1, byDay: ['FR', 'MO', 'FR'] })).toEqual({
      freq: 'weekly',
      interval: 1,
      byDay: ['MO', 'FR'],
    });
  });

  it('refuses a weekly rule with no days, a zero interval, and unknown frequencies', () => {
    expect(failedPaths(ruleSchema, { freq: 'weekly', interval: 1, byDay: [] })).toEqual(['byDay']);
    expect(failedPaths(ruleSchema, { freq: 'daily', interval: 0 })).toEqual(['interval']);
    expect(failedPaths(ruleSchema, { freq: 'daily', interval: 1.5 })).toEqual(['interval']);
    expect(failedPaths(ruleSchema, { freq: 'monthly', interval: 1 })).toEqual(['freq']);
  });

  it('drops fields the rule format does not have', () => {
    expect(ruleSchema.parse({ freq: 'daily', interval: 2, count: 10 })).toEqual({
      freq: 'daily',
      interval: 2,
    });
  });
});

describe('groups', () => {
  it('fills the defaults for a new group', () => {
    expect(
      createGroupSchema.parse({ id: ID, name: ' Classes ', activeFrom: '2026-07-13' }),
    ).toEqual({
      id: ID,
      name: 'Classes',
      colorToken: 'blue',
      activeFrom: '2026-07-13',
      activeTo: null,
      observesHolidays: true,
      attendance: true,
      attendanceThresholdPct: 75,
      attendanceTrackingFrom: null,
    });
  });

  it('needs a client-generated UUIDv7 id', () => {
    const base = { name: 'Classes', activeFrom: '2026-07-13' };
    expect(failedPaths(createGroupSchema, base)).toEqual(['id']);
    // A version-4 UUID: random, so new rows would land all over the index.
    expect(
      failedPaths(createGroupSchema, { ...base, id: '0199e0a8-7a2b-4c3d-8e4f-0123456789ab' }),
    ).toEqual(['id']);
  });

  it('refuses a range that ends before it starts, and colours outside the palette', () => {
    const base = { id: ID, name: 'Classes', activeFrom: '2026-07-13' };
    expect(failedPaths(createGroupSchema, { ...base, activeTo: '2026-07-12' })).toEqual([
      'activeTo',
    ]);
    expect(failedPaths(createGroupSchema, { ...base, colorToken: '#ff0000' })).toEqual([
      'colorToken',
    ]);
  });

  it('lets an update change just one field', () => {
    expect(updateGroupSchema.parse({ activeTo: '2026-11-18' })).toEqual({ activeTo: '2026-11-18' });
    expect(updateGroupSchema.parse({})).toEqual({});
    expect(failedPaths(updateGroupSchema, { name: '   ' })).toEqual(['name']);
  });
});

describe('series', () => {
  const lab = {
    id: ID,
    groupId: GROUP_ID,
    title: 'Lab',
    rule: { freq: 'weekly', interval: 1, byDay: ['TH'] },
    startDate: '2026-07-16',
    startTime: '14:00',
    durationMin: 120,
  };

  it('defaults the subject to the title, and leaves the zone to the server', () => {
    expect(createSeriesSchema.parse(lab)).toEqual({
      ...lab,
      subject: 'Lab',
      location: null,
      untilDate: null,
    });
    expect(createSeriesSchema.parse({ ...lab, subject: 'Digital Systems Lab' }).subject).toBe(
      'Digital Systems Lab',
    );
  });

  it('turns a blank location into null', () => {
    expect(createSeriesSchema.parse({ ...lab, location: '  ' }).location).toBeNull();
    expect(createSeriesSchema.parse({ ...lab, location: ' Lab 5 ' }).location).toBe('Lab 5');
  });

  it('refuses impossible lengths and an end before the start', () => {
    expect(failedPaths(createSeriesSchema, { ...lab, durationMin: -30 })).toEqual(['durationMin']);
    expect(failedPaths(createSeriesSchema, { ...lab, durationMin: 1441 })).toEqual(['durationMin']);
    expect(failedPaths(createSeriesSchema, { ...lab, untilDate: '2026-07-01' })).toEqual([
      'untilDate',
    ]);
    expect(failedPaths(createSeriesSchema, { ...lab, title: '' })).toEqual(['title']);
    expect(failedPaths(createSeriesSchema, { ...lab, tzid: 'IST' })).toEqual(['tzid']);
  });

  it('lets an update change just one field', () => {
    expect(updateSeriesSchema.parse({ startTime: '15:00' })).toEqual({ startTime: '15:00' });
    expect(updateSeriesSchema.parse({ location: '' })).toEqual({ location: null });
  });
});

describe('the calendar window', () => {
  it('accepts up to 62 days, both ends counted', () => {
    expect(calendarQuerySchema.safeParse({ from: '2026-10-12', to: '2026-10-18' }).success).toBe(
      true,
    );
    expect(calendarQuerySchema.safeParse({ from: '2026-10-13', to: '2026-10-13' }).success).toBe(
      true,
    );
    // 2026-10-01 to 2026-12-01 is 62 days; one more is too many.
    expect(calendarQuerySchema.safeParse({ from: '2026-10-01', to: '2026-12-01' }).success).toBe(
      true,
    );
    expect(failedPaths(calendarQuerySchema, { from: '2026-10-01', to: '2026-12-02' })).toEqual([
      'to',
    ]);
  });

  it('refuses a window that ends before it starts, or a missing end', () => {
    expect(failedPaths(calendarQuerySchema, { from: '2026-10-18', to: '2026-10-12' })).toEqual([
      'to',
    ]);
    expect(failedPaths(calendarQuerySchema, { from: '2026-10-18' })).toEqual(['to']);
  });
});
