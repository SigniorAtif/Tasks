import type {
  CalendarResponse,
  Impact,
  Problem,
  ScheduleGroup,
  Series,
  UpdateOccurrence,
} from '@tasks/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alice,
  type Client,
  calendarTestApp,
  groupBody,
  json,
  newId,
  seriesBody,
  signIn,
} from '../test/calendar.ts';
import { resetDatabase } from '../test/database.ts';

const GROUPS = '/api/v1/groups';
const SERIES = '/api/v1/series';

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Alice with the sample's semester group, open-ended, and two of its classes:
 * Data Structures (Mon, Wed, Fri 08:00) and a Thursday lab, both since July.
 */
async function withTimetable() {
  const client = await signIn(calendarTestApp(), alice);
  const group = await json<ScheduleGroup>(
    await client.post(GROUPS, groupBody({ untilDate: null })),
  );
  const ds = await json<Series>(await client.post(SERIES, seriesBody(group.id)));
  const lab = await json<Series>(
    await client.post(
      SERIES,
      seriesBody(group.id, {
        title: 'DS Lab',
        rule: { freq: 'weekly', interval: 1, byDay: ['TH'] },
        startTime: '14:00',
        durationMin: 120,
      }),
    ),
  );
  return { client, group, ds, lab };
}

const SKIPPED: UpdateOccurrence = { status: 'cancelled', cancelReason: 'skipped' };

async function cancel(client: Client, seriesId: string, ...dates: string[]): Promise<void> {
  for (const date of dates) {
    const response = await client.patch(`/api/v1/occurrences/${seriesId}/${date}`, SKIPPED);
    expect(response.status).toBe(200);
  }
}

async function impact(client: Client, path: string, lastDay?: string): Promise<Impact> {
  const query = lastDay === undefined ? '' : `?lastDay=${lastDay}`;
  const response = await client.get(`${path}/impact${query}`);
  expect(response.status).toBe(200);
  return json<Impact>(response);
}

/** What the calendar shows for one series in the week of Mon 23 Nov, by original date. */
async function lastWeek(client: Client, seriesId: string): Promise<Record<string, string>> {
  const response = await client.get('/api/v1/calendar?from=2026-11-23&to=2026-11-29');
  const { occurrences } = await json<CalendarResponse>(response);
  return Object.fromEntries(
    occurrences
      .filter((o) => o.seriesId === seriesId)
      .map((o) => [o.originalDate ?? o.key, o.status]),
  );
}

describe('GET /api/v1/groups/:id/impact', () => {
  it('counts the changes a last day would hide, in every series of the group', async () => {
    const { client, group, ds, lab } = await withTimetable();
    // Before 20 Nov: Wed 18. After it: Mon 23, Wed 25 and the lab on Thu 26.
    await cancel(client, ds.id, '2026-11-18', '2026-11-23', '2026-11-25');
    await cancel(client, lab.id, '2026-11-26');

    expect(await impact(client, `${GROUPS}/${group.id}`, '2026-11-20')).toEqual({
      changesAfter: 3,
    });
  });

  it('counts nothing without a last day, or for one after every change', async () => {
    const { client, group, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-11-23');

    expect(await impact(client, `${GROUPS}/${group.id}`)).toEqual({ changesAfter: 0 });
    expect(await impact(client, `${GROUPS}/${group.id}`, '2026-11-23')).toEqual({
      changesAfter: 0,
    });
  });

  it('leaves out changes an earlier last day already hides', async () => {
    const { client, group, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-11-23', '2026-11-30');
    await client.patch(`${GROUPS}/${group.id}`, { untilDate: '2026-11-27' });

    // 30 Nov is hidden already; only 23 Nov would stop showing now.
    expect(await impact(client, `${GROUPS}/${group.id}`, '2026-11-20')).toEqual({
      changesAfter: 1,
    });
    expect(await impact(client, `${GROUPS}/${group.id}`, '2026-12-31')).toEqual({
      changesAfter: 0,
    });
  });

  it('refuses a last day that is not a date, and answers 404 for an unknown group', async () => {
    const { client, group } = await withTimetable();

    const refused = await client.get(`${GROUPS}/${group.id}/impact?lastDay=27-11-2026`);
    expect(refused.status).toBe(422);
    expect((await json<Problem>(refused)).errors).toEqual([
      { path: 'lastDay', message: 'must be a date like 2026-10-13' },
    ]);

    const unknown = await client.get(`${GROUPS}/${newId()}/impact?lastDay=2026-11-20`);
    expect(unknown.status).toBe(404);
    expect((await json<Problem>(unknown)).code).toBe('not_found');
  });
});

describe('GET /api/v1/series/:id/impact', () => {
  it("counts only this series' changes", async () => {
    const { client, ds, lab } = await withTimetable();
    await cancel(client, ds.id, '2026-11-18', '2026-11-23', '2026-11-25');
    await cancel(client, lab.id, '2026-11-26');

    expect(await impact(client, `${SERIES}/${ds.id}`, '2026-11-20')).toEqual({
      changesAfter: 2,
    });
    expect(await impact(client, `${SERIES}/${lab.id}`, '2026-11-20')).toEqual({
      changesAfter: 1,
    });
  });

  it('answers 404 for an unknown series', async () => {
    const { client } = await withTimetable();
    const unknown = await client.get(`${SERIES}/${newId()}/impact`);
    expect(unknown.status).toBe(404);
  });
});

describe('Archive: a last day, which hides and never erases', () => {
  it("a group's last day ends every series in it, keeps the past, and moving it later brings the changes back", async () => {
    const { client, group, ds, lab } = await withTimetable();
    await cancel(client, ds.id, '2026-11-25');

    const archived = await client.patch(`${GROUPS}/${group.id}`, { untilDate: '2026-11-24' });
    expect(archived.status).toBe(200);
    // Mon 23 stays; Wed 25, Thu 26 and Fri 27 come after the last day.
    expect(await lastWeek(client, ds.id)).toEqual({ '2026-11-23': 'scheduled' });
    expect(await lastWeek(client, lab.id)).toEqual({});

    await client.patch(`${GROUPS}/${group.id}`, { untilDate: null });
    expect(await lastWeek(client, ds.id)).toEqual({
      '2026-11-23': 'scheduled',
      '2026-11-25': 'cancelled',
      '2026-11-27': 'scheduled',
    });
    expect(await lastWeek(client, lab.id)).toEqual({ '2026-11-26': 'scheduled' });
  });

  it("a series' last day ends only that series, and moving it later brings its changes back", async () => {
    const { client, ds, lab } = await withTimetable();
    await cancel(client, ds.id, '2026-11-25');

    const archived = await client.patch(`${SERIES}/${ds.id}`, { untilDate: '2026-11-24' });
    expect(archived.status).toBe(200);
    expect(await lastWeek(client, ds.id)).toEqual({ '2026-11-23': 'scheduled' });
    expect(await lastWeek(client, lab.id)).toEqual({ '2026-11-26': 'scheduled' });

    await client.patch(`${SERIES}/${ds.id}`, { untilDate: '2026-12-31' });
    expect(await lastWeek(client, ds.id)).toMatchObject({ '2026-11-25': 'cancelled' });
  });

  it("a series that hasn't started can't take a last day before its first", async () => {
    const { client, group } = await withTimetable();
    const next = await json<Series>(
      await client.post(SERIES, seriesBody(group.id, { startDate: '2026-12-07' })),
    );

    const refused = await client.patch(`${SERIES}/${next.id}`, { untilDate: '2026-11-10' });
    expect(refused.status).toBe(422);
    expect((await json<Problem>(refused)).errors).toEqual([
      { path: 'untilDate', message: 'must be on or after startDate' },
    ]);
  });
});
