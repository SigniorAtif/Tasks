// Database rows → the shapes the HTTP contract promises (`packages/core`).
// Drizzle hands back what Postgres stores, which differs in small ways:
// `time` comes back as `HH:MM:SS` (the contract says `HH:MM`), `timestamptz`
// as a JS `Date` (the contract says an ISO string in UTC), and every row has
// `userId`, `createdAt` and `updatedAt`, which the contract leaves out.
// Mapping field by field, instead of spreading the row, means a new column
// never reaches clients by accident.

import type { Instant, ScheduleGroup, Series, WallTime } from '@tasks/core';
import type { scheduleGroup, series } from '../db/schema.ts';

export type GroupRow = typeof scheduleGroup.$inferSelect;
export type SeriesRow = typeof series.$inferSelect;

/** `Date` → `2026-10-12T04:30:00.000Z`, keeping `null`. */
export function toInstant(value: Date | null): Instant | null {
  return value === null ? null : value.toISOString();
}

/** `08:00:00` → `08:00`. The API only takes whole minutes, so the seconds are always zero. */
export function toWallTime(value: string): WallTime {
  return value.slice(0, 5);
}

export function toGroup(row: GroupRow): ScheduleGroup {
  return {
    id: row.id,
    name: row.name,
    colorToken: row.colorToken,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    observesHolidays: row.observesHolidays,
    attendance: row.attendance,
    attendanceThresholdPct: row.attendanceThresholdPct,
    attendanceTrackingFrom: row.attendanceTrackingFrom,
    archivedAt: toInstant(row.archivedAt),
  };
}

export function toSeries(row: SeriesRow): Series {
  return {
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    subject: row.subject,
    location: row.location,
    rule: row.rule,
    startDate: row.startDate,
    untilDate: row.untilDate,
    startTime: toWallTime(row.startTime),
    durationMin: row.durationMin,
    tzid: row.tzid,
    previousSeriesId: row.previousSeriesId,
  };
}
