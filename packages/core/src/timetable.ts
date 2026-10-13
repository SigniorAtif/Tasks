// The timetable file (D-020): a small JSON file a person can write by hand from
// a printed class timetable, one line per slot, and that the seed script (and,
// later, an import screen) turns into groups and series.
//
//   {
//     "format": "tasks.timetable",
//     "version": 1,
//     "tzid": "Asia/Kolkata",
//     "groups": [
//       {
//         "name": "Classes · Sem 3 (sample)",
//         "activeFrom": "2026-07-13",
//         "classes": [
//           { "title": "DS", "subject": "Data Structures", "location": "C-301",
//             "day": "MO", "start": "08:00", "end": "09:00" }
//         ]
//       }
//     ]
//   }
//
// It speaks the timetable's language (a day, a start and an end), never RRULE
// strings, which people and LLMs get wrong. Each class line becomes one weekly
// series. Unknown keys are refused everywhere: a typo like "loaction" is an
// error rather than silently ignored, and anything new (v0.3b's holidays)
// arrives with a version bump.

import { z } from 'zod';
import { MAX_INTERVAL } from './recurrence/dates.ts';
import {
  type CreateGroup,
  type CreateSeries,
  createGroupSchema,
  createSeriesSchema,
  ianaZoneSchema,
  isoDateSchema,
  wallTimeSchema,
} from './schemas.ts';
import type { Weekday } from './types.ts';

/** The value of `"format"`: says what kind of file this is before anything else is read. */
export const TIMETABLE_FORMAT = 'tasks.timetable';

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const satisfies readonly Weekday[];

// The fields borrow the API's own rules (lengths, defaults, the palette), so a
// file can never hold something `POST /api/v1/groups` or `/series` would refuse.
// (The series schema ends in a transform, so its fields live on `.in`.)
const group = createGroupSchema.shape;
const series = createSeriesSchema.in.shape;

const isTime = (value: string) => wallTimeSchema.safeParse(value).success;
const isDate = (value: string) => isoDateSchema.safeParse(value).success;

/** `HH:MM` → minutes since midnight. */
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** One slot of the timetable: "DS, Monday 08:00–09:00 in C-301". */
const classSchema = z
  .strictObject({
    /** The short name on the calendar block. */
    title: series.title,
    /** What attendance is counted by (B8). Defaults to the title. */
    subject: series.subject,
    location: series.location,
    day: z.enum(WEEKDAYS),
    start: wallTimeSchema,
    /** On the same day as `start`: a class can't run past midnight. */
    end: wallTimeSchema,
    /** 2 = every other week, counted from the week of the first class. */
    everyWeeks: z.number().int().min(1).max(MAX_INTERVAL.weekly).default(1),
    /** The first day it can happen. Defaults to the group's `activeFrom`. */
    from: isoDateSchema.optional(),
    /** The last day it can happen. Defaults to "until the group ends". */
    until: isoDateSchema.nullable().optional(),
  })
  .superRefine((row, ctx) => {
    // zod runs this even when a field failed above, so compare only real values.
    if (isTime(row.start) && isTime(row.end) && minutesOf(row.end) <= minutesOf(row.start)) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'must be after start, on the same day',
      });
    }
    if (row.from !== undefined && row.until != null && isDate(row.from) && row.until < row.from) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: 'must be on or after from' });
    }
  });

/** "Classes · Sem 3": the group's own settings plus its classes. */
const groupSchema = z
  .strictObject({
    name: group.name,
    colorToken: group.colorToken,
    activeFrom: group.activeFrom,
    activeTo: group.activeTo,
    observesHolidays: group.observesHolidays,
    attendance: group.attendance,
    attendanceThresholdPct: group.attendanceThresholdPct,
    attendanceTrackingFrom: group.attendanceTrackingFrom,
    classes: z.array(classSchema),
  })
  .superRefine((g, ctx) => {
    if (g.activeTo != null && isDate(g.activeFrom) && g.activeTo < g.activeFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['activeTo'],
        message: 'must be on or after activeFrom',
      });
    }
    // A class without its own `from` starts with the group, so it can't end before it.
    g.classes.forEach((row, index) => {
      const usesGroupStart = row.from === undefined && isDate(g.activeFrom);
      if (usesGroupStart && row.until != null && row.until < g.activeFrom) {
        ctx.addIssue({
          code: 'custom',
          path: ['classes', index, 'until'],
          message: 'must be on or after activeFrom',
        });
      }
    });
  });

/** A whole timetable file. Errors name the line: `groups.0.classes.3.end`. */
export const timetableFileSchema = z
  .strictObject({
    format: z.literal(TIMETABLE_FORMAT),
    version: z.literal(1),
    /** The zone every time in the file is in (D-025). */
    tzid: ianaZoneSchema,
    groups: z.array(groupSchema).min(1, 'add at least one group'),
  })
  .superRefine((file, ctx) => {
    // The seed replaces groups by name, so two with one name would be ambiguous.
    const seen = new Map<string, number>();
    file.groups.forEach((g, index) => {
      const first = seen.get(g.name);
      if (first === undefined) seen.set(g.name, index);
      else {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'name'],
          message: `is already the name of groups.${first}`,
        });
      }
    });
  });

/** A file as written (optional fields may be missing). */
export type TimetableFileInput = z.input<typeof timetableFileSchema>;
/** A file after `timetableFileSchema.parse`: checked, with the defaults filled in. */
export type TimetableFile = z.output<typeof timetableFileSchema>;

/**
 * Turns a checked file into the rows `POST /api/v1/groups` and `/series` take:
 * one group per group, one weekly series per class line. Pure: `newId` makes
 * the ids (UUIDv7 in the app, a counter in tests).
 */
export function timetableToRows(
  file: TimetableFile,
  newId: () => string,
): { groups: CreateGroup[]; series: CreateSeries[] } {
  const groups: CreateGroup[] = [];
  const seriesRows: CreateSeries[] = [];
  for (const { classes, ...fields } of file.groups) {
    const groupId = newId();
    groups.push({ id: groupId, ...fields });
    for (const row of classes) {
      seriesRows.push({
        id: newId(),
        groupId,
        title: row.title,
        subject: row.subject ?? row.title,
        location: row.location,
        rule: { freq: 'weekly', interval: row.everyWeeks, byDay: [row.day] },
        startDate: row.from ?? fields.activeFrom,
        untilDate: row.until ?? null,
        startTime: row.start,
        durationMin: minutesOf(row.end) - minutesOf(row.start),
        tzid: file.tzid,
      });
    }
  }
  return { groups, series: seriesRows };
}
