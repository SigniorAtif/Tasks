import type { Problem, ScheduleGroup, Series, SeriesList } from '@tasks/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authUser, profile, scheduleGroup, series } from '../db/schema.ts';
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

const GROUPS = '/api/v1/groups';
const SERIES = '/api/v1/series';

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Alice, signed in, with the sample's semester group. */
async function withGroup(): Promise<{ client: Client; group: ScheduleGroup }> {
  const client = await signIn(calendarTestApp(), alice);
  const group = await json<ScheduleGroup>(await client.post(GROUPS, groupBody()));
  return { client, group };
}

async function create(client: Client, body: ReturnType<typeof seriesBody>): Promise<Series> {
  const response = await client.post(SERIES, body);
  expect(response.status).toBe(201);
  return json<Series>(response);
}

describe('POST /api/v1/series', () => {
  it('creates the series in the profile zone, with the defaults filled in', async () => {
    const { client, group } = await withGroup();
    const body = seriesBody(group.id, {
      // Days in any order: stored Monday first.
      rule: { freq: 'weekly', interval: 1, byDay: ['FR', 'MO', 'WE'] },
    });
    const response = await client.post(SERIES, body);

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`${SERIES}/${body.id}`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      id: body.id,
      groupId: group.id,
      title: 'Data Structures',
      subject: 'Data Structures',
      location: 'C-301',
      rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] },
      startDate: '2026-07-13',
      untilDate: null,
      startTime: '08:00',
      durationMin: 60,
      tzid: 'Asia/Kolkata',
      previousSeriesId: null,
    } satisfies Series);
  });

  it("uses the user's profile zone when none is sent, and the sent one otherwise", async () => {
    const { client, group } = await withGroup();
    await testDb.update(profile).set({ tzid: 'Europe/London' });

    const fromProfile = await create(client, seriesBody(group.id));
    const sent = await create(client, seriesBody(group.id, { tzid: 'america/new_york' }));
    expect(fromProfile.tzid).toBe('Europe/London');
    expect(sent.tzid).toBe('America/New_York');
  });

  it('answers a repeated create with the existing row, unchanged (D-042)', async () => {
    const { client, group } = await withGroup();
    const body = seriesBody(group.id);
    const first = await create(client, body);

    const again = await client.post(SERIES, { ...body, title: 'Something else' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(await testDb.select().from(series)).toHaveLength(1);
  });

  it("answers 409 when the id is taken by a row this user can't see", async () => {
    const { client, group } = await withGroup();
    const taken = await someoneElsesSeries();
    const response = await client.post(SERIES, seriesBody(group.id, { id: taken }));
    expect(response.status).toBe(409);
    expect((await json<Problem>(response)).code).toBe('conflict');
  });

  it("names groupId when the group isn't one of the user's", async () => {
    const { client } = await withGroup();
    const response = await client.post(SERIES, seriesBody(newId()));
    expect(response.status).toBe(422);
    expect(await json<Problem>(response)).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'groupId', message: 'must be one of your groups' }],
    });
  });

  it('refuses invalid fields, naming each', async () => {
    const { client, group } = await withGroup();
    const response = await client.post(
      SERIES,
      seriesBody(group.id, {
        rule: { freq: 'weekly', interval: 1, byDay: [] },
        startTime: '8am',
        durationMin: 0,
        tzid: 'IST',
      }),
    );
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).errors?.map((error) => error.path).sort()).toEqual([
      'durationMin',
      'rule.byDay',
      'startTime',
      'tzid',
    ]);
  });
});

/** Another user's series, written straight to the database. Returns its id. */
async function someoneElsesSeries(): Promise<string> {
  const [someone] = await testDb
    .insert(authUser)
    .values({ name: 'Someone', email: 'someone@example.com' })
    .returning();
  if (!someone) throw new Error('insert returned nothing');
  const [theirs] = await testDb
    .insert(scheduleGroup)
    .values({ userId: someone.id, name: 'Health', activeFrom: '2026-07-01' })
    .returning();
  if (!theirs) throw new Error('insert returned nothing');
  const id = newId();
  await testDb.insert(series).values({
    id,
    userId: someone.id,
    groupId: theirs.id,
    title: 'Evening run',
    subject: 'Evening run',
    rule: { freq: 'daily', interval: 1 },
    startDate: '2026-07-01',
    startTime: '18:00',
    durationMin: 45,
    tzid: 'Asia/Kolkata',
  });
  return id;
}

/** A second group for the same client (the first one is made by `withGroup`). */
async function withGroupFor(client: Client): Promise<{ group: ScheduleGroup }> {
  const response = await client.post(GROUPS, groupBody({ name: 'Health', activeTo: null }));
  return { group: await json<ScheduleGroup>(response) };
}

describe('GET /api/v1/series', () => {
  it('lists every series in every group, by title', async () => {
    const { client, group } = await withGroup();
    const { group: health } = await withGroupFor(client);
    await create(client, seriesBody(group.id, { title: 'Economics' }));
    await create(client, seriesBody(health.id, { title: 'Evening run', location: null }));
    await create(client, seriesBody(group.id, { title: 'Digital Systems' }));

    const response = await client.get(SERIES);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const list = await json<SeriesList>(response);
    expect(list.series.map((s) => s.title)).toEqual([
      'Digital Systems',
      'Economics',
      'Evening run',
    ]);
  });
});

describe('GET /api/v1/series/:id', () => {
  it('returns the series, and 404 for unknown or malformed ids', async () => {
    const { client, group } = await withGroup();
    const created = await create(client, seriesBody(group.id));
    expect(await json<Series>(await client.get(`${SERIES}/${created.id}`))).toEqual(created);

    for (const id of [newId(), '12345']) {
      const response = await client.get(`${SERIES}/${id}`);
      expect(response.status).toBe(404);
      expect((await json<Problem>(response)).detail).toBe('No series with that id.');
    }
  });
});

describe('PATCH /api/v1/series/:id', () => {
  it('changes only the fields sent, for every occurrence', async () => {
    const { client, group } = await withGroup();
    const created = await create(client, seriesBody(group.id));
    const response = await client.patch(`${SERIES}/${created.id}`, {
      startTime: '09:00',
      location: '  ',
      rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...created,
      startTime: '09:00',
      // Blank text is stored as "no location".
      location: null,
      rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
    });
  });

  it("moves a series to another of the user's groups, but not to an unknown one", async () => {
    const { client, group } = await withGroup();
    const { group: health } = await withGroupFor(client);
    const created = await create(client, seriesBody(group.id));

    const moved = await client.patch(`${SERIES}/${created.id}`, { groupId: health.id });
    expect((await json<Series>(moved)).groupId).toBe(health.id);

    const refused = await client.patch(`${SERIES}/${created.id}`, { groupId: newId() });
    expect(refused.status).toBe(422);
    expect((await json<Problem>(refused)).errors?.[0]?.path).toBe('groupId');
  });

  it('checks the dates against the stored ones and names the field that was sent', async () => {
    const { client, group } = await withGroup();
    const created = await create(client, seriesBody(group.id, { untilDate: '2026-11-27' }));

    const until = await client.patch(`${SERIES}/${created.id}`, { untilDate: '2026-07-01' });
    expect(until.status).toBe(422);
    expect((await json<Problem>(until)).errors).toEqual([
      { path: 'untilDate', message: 'must be on or after startDate' },
    ]);

    const start = await client.patch(`${SERIES}/${created.id}`, { startDate: '2026-12-01' });
    expect(start.status).toBe(422);
    expect((await json<Problem>(start)).errors).toEqual([
      { path: 'startDate', message: 'must be on or before untilDate' },
    ]);
  });

  it('answers 404 for an unknown id', async () => {
    const { client } = await withGroup();
    expect((await client.patch(`${SERIES}/${newId()}`, { title: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/v1/series/:id', () => {
  it('deletes the series', async () => {
    const { client, group } = await withGroup();
    const created = await create(client, seriesBody(group.id));
    const response = await client.delete(`${SERIES}/${created.id}`);
    expect(response.status).toBe(204);
    expect((await client.get(`${SERIES}/${created.id}`)).status).toBe(404);
    expect((await client.delete(`${SERIES}/${created.id}`)).status).toBe(404);
  });

  it('goes with its group when the group is deleted', async () => {
    const { client, group } = await withGroup();
    const created = await create(client, seriesBody(group.id));
    expect((await client.delete(`${GROUPS}/${group.id}`)).status).toBe(204);
    expect((await client.get(`${SERIES}/${created.id}`)).status).toBe(404);
    expect(await testDb.select().from(series).where(eq(series.id, created.id))).toEqual([]);
  });
});
