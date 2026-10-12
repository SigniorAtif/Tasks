// Small factories so each test states only what matters to it.

import type {
  CancelReason,
  DayException,
  ExtraOverride,
  ModifiedOverride,
  ScheduleGroup,
  Series,
} from '../types.ts';

export function group(fields: Partial<ScheduleGroup> = {}): ScheduleGroup {
  return {
    id: 'g',
    name: 'Classes',
    colorToken: 'blue',
    activeFrom: '2026-01-01',
    activeTo: null,
    observesHolidays: true,
    attendance: true,
    attendanceThresholdPct: 75,
    attendanceTrackingFrom: null,
    archivedAt: null,
    ...fields,
  };
}

export function series(fields: Partial<Series> = {}): Series {
  return {
    id: 's',
    groupId: 'g',
    title: 'DBMS',
    subject: 'DBMS',
    location: null,
    rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] },
    startDate: '2026-10-05',
    untilDate: null,
    startTime: '10:00',
    durationMin: 60,
    tzid: 'Asia/Kolkata',
    previousSeriesId: null,
    ...fields,
  };
}

/** An override that changes nothing yet; tests set the fields they care about. */
export function modified(
  seriesId: string,
  originalDate: string,
  fields: Partial<ModifiedOverride> = {},
): ModifiedOverride {
  return {
    kind: 'modified',
    id: `o-${seriesId}-${originalDate}`,
    seriesId,
    originalDate,
    status: null,
    cancelReason: null,
    newDate: null,
    newStartTime: null,
    durationMin: null,
    confirmedAt: null,
    note: null,
    ...fields,
  };
}

export const cancel = (seriesId: string, date: string, reason: CancelReason | null = null) =>
  modified(seriesId, date, { status: 'cancelled', cancelReason: reason });

export const move = (
  seriesId: string,
  date: string,
  newDate: string | null,
  newStartTime: string | null = null,
) => modified(seriesId, date, { newDate, newStartTime });

export function extra(
  id: string,
  seriesId: string,
  newDate: string,
  newStartTime: string,
  fields: Partial<ExtraOverride> = {},
): ExtraOverride {
  return {
    kind: 'extra',
    id,
    seriesId,
    originalDate: null,
    newDate,
    newStartTime,
    status: null,
    cancelReason: null,
    durationMin: null,
    confirmedAt: null,
    note: null,
    ...fields,
  };
}

export function dayOff(
  day: string,
  effect: CancelReason = 'not_held',
  label = 'Holiday',
): DayException {
  return { id: `d-${day}-${effect}`, day, effect, label, batchId: 'batch-1' };
}
