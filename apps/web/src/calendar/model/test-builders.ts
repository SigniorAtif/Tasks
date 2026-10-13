// Small factories for the calendar tests, so each test states only what
// matters to it. Not a test file itself (no `.test.`), and nothing in the app
// imports it, so it never reaches the bundle.

import type { Occurrence } from '@tasks/core';
import type { Segment } from './segments.ts';

/** An ordinary scheduled class; pass the fields the test is about. */
export function occurrence(fields: Partial<Occurrence> = {}): Occurrence {
  return {
    key: 's:2026-10-06',
    seriesId: 's',
    groupId: 'g',
    title: 'DS',
    subject: 'Data Structures',
    location: null,
    originalDate: '2026-10-06',
    date: '2026-10-06',
    start: '2026-10-06T04:30:00Z',
    end: '2026-10-06T05:30:00Z',
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
    ...fields,
  };
}

/** `'10:30'` → 630. */
const minute = (wall: string) => {
  const [h = '0', m = '0'] = wall.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * A segment on one day, straight from wall-clock times, for layout tests that
 * don't care about zones: `segment('A', '10:00', '11:00')`.
 */
export function segment(
  key: string,
  from: string,
  to: string,
  fields: Partial<Occurrence> = {},
): Segment {
  return {
    occ: occurrence({ key: `${key}:2026-10-06`, title: key, ...fields }),
    day: '2026-10-06',
    startMin: minute(from),
    endMin: minute(to),
    continuesBefore: false,
    continuesAfter: false,
  };
}
