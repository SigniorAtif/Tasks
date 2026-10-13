import {
  type CalendarResponse,
  expand,
  type GroupList,
  type Problem,
  type ScheduleGroup,
  type Series,
  type SeriesList,
} from '@tasks/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceOverride } from '../db/schema.ts';
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
import { resetDatabase, testDb } from '../test/database.ts';

const CALENDAR = '/api/v1/calendar';

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Alice with the sample's semester group and its Data Structures class (Mon, Wed, Fri 08:00). */
async function withTimetable(): Promise<{ client: Client; group: ScheduleGroup; ds: Series }> {
  const client = await signIn(calendarTestApp(), alice);
  const group = await json<ScheduleGroup>(await client.post('/api/v1/groups', groupBody()));
  const ds = await json<Series>(await client.post('/api/v1/series', seriesBody(group.id)));
  return { client, group, ds };
}

async function calendar(client: Client, from: string, to: string): Promise<CalendarResponse> {
  const response = await client.get(`${CALENDAR}?from=${from}&to=${to}`);
  expect(response.status).toBe(200);
  return json<CalendarResponse>(response);
}

describe('GET /api/v1/calendar', () => {
  it("answers exactly what expand() makes of the user's rows", async () => {
    const { client, group } = await withTimetable();
    await client.post(
      '/api/v1/series',
      seriesBody(group.id, {
        title: 'Digital Systems Lab',
        location: 'Lab 5',
        rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
        startDate: '2026-07-16',
        startTime: '14:00',
        durationMin: 120,
      }),
    );
    const { groups } = await json<GroupList>(await client.get('/api/v1/groups'));
    const { series } = await json<SeriesList>(await client.get('/api/v1/series'));

    const response = await client.get(`${CALENDAR}?from=2026-10-12&to=2026-10-25`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const window = { from: '2026-10-12', to: '2026-10-25' };
    expect(await response.json()).toEqual({
      ...window,
      occurrences: expand({ groups, series, overrides: [], dayExceptions: [], window }),
    });
  });

  it('places each occurrence at its wall time in the series zone', async () => {
    const { client, ds } = await withTimetable();
    const { occurrences } = await calendar(client, '2026-10-12', '2026-10-18');
    expect(occurrences.map((o) => [o.date, o.start, o.end])).toEqual([
      // 08:00 in Asia/Kolkata (UTC+05:30) is 02:30 UTC.
      ['2026-10-12', '2026-10-12T02:30:00Z', '2026-10-12T03:30:00Z'],
      ['2026-10-14', '2026-10-14T02:30:00Z', '2026-10-14T03:30:00Z'],
      ['2026-10-16', '2026-10-16T02:30:00Z', '2026-10-16T03:30:00Z'],
    ]);
    expect(occurrences[0]).toMatchObject({
      key: `${ds.id}:2026-10-12`,
      title: 'Data Structures',
      location: 'C-301',
      tzid: 'Asia/Kolkata',
      status: 'scheduled',
    });
  });

  it('applies the overrides stored for the window: a cancel, moves and an extra', async () => {
    const { client, ds } = await withTimetable();
    const base = { userId: client.userId, seriesId: ds.id };
    const extraId = newId();
    // Nothing writes overrides in v0.2 (v0.3 does), so the test writes them directly.
    await testDb.insert(occurrenceOverride).values([
      // Wednesday's class didn't happen.
      {
        ...base,
        kind: 'modified',
        originalDate: '2026-10-07',
        status: 'cancelled',
        cancelReason: 'not_held',
      },
      // Friday's class moved to Saturday at 10:00.
      {
        ...base,
        kind: 'modified',
        originalDate: '2026-10-09',
        newDate: '2026-10-10',
        newStartTime: '10:00',
      },
      // Next Monday's class moved INTO this week, to Sunday (same time).
      { ...base, kind: 'modified', originalDate: '2026-10-12', newDate: '2026-10-11' },
      // A make-up class on Saturday at 12:00.
      { ...base, id: extraId, kind: 'extra', newDate: '2026-10-10', newStartTime: '12:00' },
      // Outside the window: no effect here.
      { ...base, kind: 'modified', originalDate: '2026-11-02', status: 'cancelled' },
    ]);

    const { occurrences } = await calendar(client, '2026-10-05', '2026-10-11');
    expect(
      occurrences.map(({ originalDate, date, start, status, cancelReason, moved, extra }) => ({
        originalDate,
        date,
        start,
        status,
        cancelReason,
        moved,
        extra,
      })),
    ).toEqual([
      {
        originalDate: '2026-10-05',
        date: '2026-10-05',
        start: '2026-10-05T02:30:00Z',
        status: 'scheduled',
        cancelReason: null,
        moved: false,
        extra: false,
      },
      {
        originalDate: '2026-10-07',
        date: '2026-10-07',
        start: '2026-10-07T02:30:00Z',
        status: 'cancelled',
        cancelReason: 'not_held',
        moved: false,
        extra: false,
      },
      {
        originalDate: '2026-10-09',
        date: '2026-10-10',
        start: '2026-10-10T04:30:00Z',
        status: 'scheduled',
        cancelReason: null,
        moved: true,
        extra: false,
      },
      {
        originalDate: null,
        date: '2026-10-10',
        start: '2026-10-10T06:30:00Z',
        status: 'scheduled',
        cancelReason: null,
        moved: false,
        extra: true,
      },
      {
        originalDate: '2026-10-12',
        date: '2026-10-11',
        start: '2026-10-11T02:30:00Z',
        status: 'scheduled',
        cancelReason: null,
        moved: true,
        extra: false,
      },
    ]);
    expect(occurrences[3]?.key).toBe(`x:${extraId}`);
  });

  it('is empty for a user with no series', async () => {
    const client = await signIn(calendarTestApp(), alice);
    expect(await calendar(client, '2026-10-12', '2026-10-18')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
      occurrences: [],
    });
  });

  it('answers a window of exactly 62 days', async () => {
    const { client } = await withTimetable();
    const { occurrences } = await calendar(client, '2026-10-01', '2026-12-01');
    // The group ends on 2026-11-27, the last Friday it has.
    expect(occurrences.at(-1)?.date).toBe('2026-11-27');
  });

  it.each([
    ['no parameters', '', ['from', 'to']],
    ['a missing to', '?from=2026-10-12', ['to']],
    ['a from date that does not exist', '?from=2026-02-30&to=2026-03-01', ['from']],
    ['a to date that does not exist', '?from=2026-02-01&to=2026-02-31', ['to']],
    ['to before from', '?from=2026-10-18&to=2026-10-12', ['to']],
    ['a 63-day window', '?from=2026-10-01&to=2026-12-02', ['to']],
  ])('refuses %s with a 422 naming the field', async (_, query, paths) => {
    const client = await signIn(calendarTestApp(), alice);
    const response = await client.get(`${CALENDAR}${query}`);
    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const problem = await json<Problem>(response);
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors?.map((error) => error.path)).toEqual(paths);
  });

  it('needs a session', async () => {
    const { app } = calendarTestApp();
    const response = await app.request(`${CALENDAR}?from=2026-10-12&to=2026-10-18`);
    expect(response.status).toBe(401);
  });
});
