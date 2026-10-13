// Database rows → the shapes the HTTP contract promises (`packages/core`).
// Drizzle hands back what Postgres stores, which differs in small ways:
// `time` comes back as `HH:MM:SS` (the contract says `HH:MM`), `timestamptz`
// as a JS `Date` (the contract says an ISO string in UTC), and every row has
// `userId`, `createdAt` and `updatedAt`, which the contract leaves out.
// Mapping field by field, instead of spreading the row, means a new column
// never reaches clients by accident.

import type { Instant, ScheduleGroup } from '@tasks/core';
import type { scheduleGroup } from '../db/schema.ts';

export type GroupRow = typeof scheduleGroup.$inferSelect;

/** `Date` → `2026-10-12T04:30:00.000Z`, keeping `null`. */
export function toInstant(value: Date | null): Instant | null {
  return value === null ? null : value.toISOString();
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
