import type {
  CalendarResponse,
  Impact,
  Problem,
  ScheduleGroup,
  Series,
  SeriesImpact,
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

/** What the change in `ask` (`{ lastDay: '2026-11-20' }`, …) would hide in the row at `path`. */
async function impact(
  client: Client,
  path: string,
  ask: Record<string, string> = {},
): Promise<Impact | SeriesImpact> {
  const response = await client.get(`${path}/impact?${new URLSearchParams(ask)}`);
  expect(response.status).toBe(200);
  return json<Impact | SeriesImpact>(response);
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

    expect(await impact(client, `${GROUPS}/${group.id}`, { lastDay: '2026-11-20' })).toMatchObject({
      changesAfter: 3,
    });
  });

  it('counts nothing without a last day, or for one after every change', async () => {
    const { client, group, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-11-23');

    expect(await impact(client, `${GROUPS}/${group.id}`)).toMatchObject({ changesAfter: 0 });
    expect(await impact(client, `${GROUPS}/${group.id}`, { lastDay: '2026-11-23' })).toMatchObject({
      changesAfter: 0,
    });
  });

  it('leaves out changes an earlier last day already hides', async () => {
    const { client, group, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-11-23', '2026-11-30');
    await client.patch(`${GROUPS}/${group.id}`, { untilDate: '2026-11-27' });

    // 30 Nov is hidden already; only 23 Nov would stop showing now.
    expect(await impact(client, `${GROUPS}/${group.id}`, { lastDay: '2026-11-20' })).toMatchObject({
      changesAfter: 1,
    });
    expect(await impact(client, `${GROUPS}/${group.id}`, { lastDay: '2026-12-31' })).toMatchObject({
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

    expect(await impact(client, `${SERIES}/${ds.id}`, { lastDay: '2026-11-20' })).toMatchObject({
      changesAfter: 2,
      changesBefore: 0,
      changesOffTiming: 0,
    });
    expect(await impact(client, `${SERIES}/${lab.id}`, { lastDay: '2026-11-20' })).toMatchObject({
      changesAfter: 1,
      changesBefore: 0,
      changesOffTiming: 0,
    });
  });

  it('answers 404 for an unknown series', async () => {
    const { client } = await withTimetable();
    const unknown = await client.get(`${SERIES}/${newId()}/impact`);
    expect(unknown.status).toBe(404);
  });
});

// Edge cases 2 and 3 of spec #6: Data Structures runs Mon, Wed and Fri since 13 Jul.
describe('GET /api/v1/series/:id/impact: a new first day or timing', () => {
  it('counts the changes before a later first day', async () => {
    const { client, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-09-09', '2026-10-05');

    expect(await impact(client, `${SERIES}/${ds.id}`, { firstDay: '2026-10-01' })).toMatchObject({
      changesAfter: 0,
      changesBefore: 1,
      changesOffTiming: 0,
    });
  });

  it('counts the changes on days the new days leave out', async () => {
    const { client, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-09-09', '2026-09-11');

    // Mon and Fri only: the Wednesday cancel stops showing, the Friday one stays.
    expect(
      await impact(client, `${SERIES}/${ds.id}`, { byDay: 'MO,FR', interval: '1' }),
    ).toMatchObject({
      changesAfter: 0,
      changesBefore: 0,
      changesOffTiming: 1,
    });
  });

  it("counts the changes in weeks a new interval doesn't produce", async () => {
    const { client, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-09-09', '2026-09-14');

    // Every 2 weeks counts from the week of 13 Jul: the week of 7 Sep stays, 14 Sep goes.
    expect(
      await impact(client, `${SERIES}/${ds.id}`, { byDay: 'MO,WE,FR', interval: '2' }),
    ).toMatchObject({ changesAfter: 0, changesBefore: 0, changesOffTiming: 1 });
  });

  it('counts the changes in weeks a new first day moves an every-2-weeks class off', async () => {
    const { client, lab } = await withTimetable();
    await client.patch(`${SERIES}/${lab.id}`, {
      rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
    });
    await cancel(client, lab.id, '2026-09-24');

    // Every 2 weeks counts from the first day's week. From 13 Jul the lab meets on
    // Thu 24 Sep; from 20 Jul on 17 Sep and 1 Oct instead.
    expect(await impact(client, `${SERIES}/${lab.id}`, { firstDay: '2026-07-20' })).toMatchObject({
      changesAfter: 0,
      changesBefore: 0,
      changesOffTiming: 1,
    });
  });

  it('counts nothing for a change that hides nothing', async () => {
    const { client, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-09-09', '2026-09-14');

    // An earlier first day, the same days written another way, a later last day.
    expect(
      await impact(client, `${SERIES}/${ds.id}`, {
        firstDay: '2026-07-01',
        byDay: 'FR,WE,MO',
        interval: '1',
        lastDay: '2026-12-31',
      }),
    ).toMatchObject({ changesAfter: 0, changesBefore: 0, changesOffTiming: 0 });
  });

  it('counts each change once, by its date: before the first day, after the last, or else the timing', async () => {
    const { client, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-09-09', '2026-09-14', '2026-09-16', '2026-11-25');

    // Wed 9 Sep is before the new first day (and on a Wednesday): it counts as before.
    // Mon 14 Sep still happens. Wed 16 Sep is off the new days. Wed 25 Nov is after the last day.
    expect(
      await impact(client, `${SERIES}/${ds.id}`, {
        firstDay: '2026-09-10',
        byDay: 'MO,FR',
        interval: '1',
        lastDay: '2026-11-20',
      }),
    ).toMatchObject({ changesAfter: 1, changesBefore: 1, changesOffTiming: 1 });
  });

  it('refuses a timing that is half there or not a timing', async () => {
    const { client, ds } = await withTimetable();
    const ask = (query: string) => client.get(`${SERIES}/${ds.id}/impact?${query}`);

    expect((await json<Problem>(await ask('byDay=MO'))).errors).toEqual([
      { path: 'interval', message: 'is needed with byDay' },
    ]);
    expect((await json<Problem>(await ask('interval=2'))).errors).toEqual([
      { path: 'byDay', message: 'is needed with interval' },
    ]);
    for (const query of ['byDay=XX&interval=1', 'byDay=&interval=1', 'byDay=MO&interval=0']) {
      expect((await ask(query)).status, query).toBe(422);
    }
  });
});

describe('PATCH /api/v1/series/:id: new days hide, never erase', () => {
  it('keeps the changes new days hide, and the old days bring them back', async () => {
    const { client, ds } = await withTimetable();
    await cancel(client, ds.id, '2026-11-25');

    const moved = await client.patch(`${SERIES}/${ds.id}`, {
      rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'FR'] },
    });
    expect(moved.status).toBe(200);
    expect(await lastWeek(client, ds.id)).toEqual({
      '2026-11-23': 'scheduled',
      '2026-11-27': 'scheduled',
    });

    await client.patch(`${SERIES}/${ds.id}`, {
      rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] },
    });
    expect(await lastWeek(client, ds.id)).toMatchObject({ '2026-11-25': 'cancelled' });
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

// The clock every test app reports (`TEST_NOW`) makes today Mon 12 Oct 2026.
describe('GET .../impact: hasHistory, what Delete would lose', () => {
  /** Alice with an open-ended group and nothing in it. */
  async function withEmptyGroup() {
    const client = await signIn(calendarTestApp(), alice);
    const group = await json<ScheduleGroup>(
      await client.post(GROUPS, groupBody({ untilDate: null })),
    );
    return { client, group };
  }

  it('is true for a series that has met before today, and for its group', async () => {
    const { client, group, ds } = await withTimetable();

    expect(await impact(client, `${SERIES}/${ds.id}`)).toMatchObject({ hasHistory: true });
    expect(await impact(client, `${GROUPS}/${group.id}`)).toMatchObject({ hasHistory: true });
  });

  it('is false for a series that first meets today, and for its group', async () => {
    const { client, group } = await withEmptyGroup();
    expect(await impact(client, `${GROUPS}/${group.id}`)).toMatchObject({ hasHistory: false });

    const fresh = await json<Series>(
      await client.post(SERIES, seriesBody(group.id, { startDate: '2026-10-12' })),
    );
    expect(await impact(client, `${SERIES}/${fresh.id}`)).toMatchObject({ hasHistory: false });
    expect(await impact(client, `${GROUPS}/${group.id}`)).toMatchObject({ hasHistory: false });
  });

  it('is true once a series has any override, even one on a day to come', async () => {
    const { client, group } = await withEmptyGroup();
    const fresh = await json<Series>(
      await client.post(SERIES, seriesBody(group.id, { startDate: '2026-10-12' })),
    );
    await cancel(client, fresh.id, '2026-10-14');

    expect(await impact(client, `${SERIES}/${fresh.id}`)).toMatchObject({ hasHistory: true });
    expect(await impact(client, `${GROUPS}/${group.id}`)).toMatchObject({ hasHistory: true });
  });

  it("is false when the first day has passed but the group's last day came before it", async () => {
    const client = await signIn(calendarTestApp(), alice);
    const group = await json<ScheduleGroup>(
      await client.post(GROUPS, groupBody({ untilDate: '2026-09-30' })),
    );
    const never = await json<Series>(
      await client.post(SERIES, seriesBody(group.id, { startDate: '2026-10-05' })),
    );

    expect(await impact(client, `${SERIES}/${never.id}`)).toMatchObject({ hasHistory: false });
  });
});

describe('DELETE: a group takes its series and every override with it', () => {
  it('deletes the series in the group and their overrides, and nothing else', async () => {
    const { client, group, ds, lab } = await withTimetable();
    const other = await json<ScheduleGroup>(
      await client.post(GROUPS, groupBody({ name: 'Health (sample)', untilDate: null })),
    );
    const walk = await json<Series>(
      await client.post(SERIES, seriesBody(other.id, { title: 'Evening walk' })),
    );
    await cancel(client, ds.id, '2026-11-25');
    await cancel(client, walk.id, '2026-11-25');

    expect((await client.delete(`${GROUPS}/${group.id}`)).status).toBe(204);

    expect((await client.get(`${SERIES}/${ds.id}`)).status).toBe(404);
    expect((await client.get(`${SERIES}/${lab.id}`)).status).toBe(404);
    expect(await lastWeek(client, ds.id)).toEqual({});
    // The other group's series keeps its cancel.
    expect(await lastWeek(client, walk.id)).toMatchObject({ '2026-11-25': 'cancelled' });

    // The same class made again under its old id starts clean: the cancel went too.
    const { id: _, ...sameClass } = seriesBody(other.id);
    const again = await client.post(SERIES, { id: ds.id, ...sameClass });
    expect(again.status).toBe(201);
    expect(await lastWeek(client, ds.id)).toMatchObject({ '2026-11-25': 'scheduled' });
  });

  it("deleting one series takes its overrides and leaves the group's others", async () => {
    const { client, group, ds, lab } = await withTimetable();
    await cancel(client, ds.id, '2026-11-25');
    await cancel(client, lab.id, '2026-11-26');

    expect((await client.delete(`${SERIES}/${ds.id}`)).status).toBe(204);

    expect(await lastWeek(client, ds.id)).toEqual({});
    expect(await lastWeek(client, lab.id)).toEqual({ '2026-11-26': 'cancelled' });
    const { id: _, ...sameClass } = seriesBody(group.id);
    expect((await client.post(SERIES, { id: ds.id, ...sameClass })).status).toBe(201);
    expect(await lastWeek(client, ds.id)).toMatchObject({ '2026-11-25': 'scheduled' });
  });
});
