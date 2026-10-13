import type { GroupList, Problem, ScheduleGroup } from '@tasks/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authUser, scheduleGroup } from '../db/schema.ts';
import {
  alice,
  type Client,
  calendarTestApp,
  groupBody,
  json,
  newId,
  signIn,
} from '../test/calendar.ts';
import { resetDatabase, testDb } from '../test/database.ts';

const GROUPS = '/api/v1/groups';

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

async function signedIn(): Promise<Client> {
  return signIn(calendarTestApp(), alice);
}

async function create(client: Client, fields: Parameters<typeof groupBody>[0] = {}) {
  const response = await client.post(GROUPS, groupBody(fields));
  expect(response.status).toBe(201);
  return json<ScheduleGroup>(response);
}

describe('POST /api/v1/groups', () => {
  it('creates the group with the defaults filled in and says where it lives', async () => {
    const client = await signedIn();
    const body = groupBody({ name: '  Classes · Sem 3 (sample)  ' });
    const response = await client.post(GROUPS, body);

    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`${GROUPS}/${body.id}`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      id: body.id,
      name: 'Classes · Sem 3 (sample)',
      colorToken: 'blue',
      activeFrom: '2026-07-13',
      activeTo: '2026-11-27',
      observesHolidays: true,
      attendance: true,
      attendanceThresholdPct: 75,
      attendanceTrackingFrom: null,
      archivedAt: null,
    } satisfies ScheduleGroup);
  });

  it('answers a repeated create with the existing row, unchanged (D-042)', async () => {
    const client = await signedIn();
    const body = groupBody();
    const first = await json<ScheduleGroup>(await client.post(GROUPS, body));

    const again = await client.post(GROUPS, { ...body, name: 'A different name' });
    expect(again.status).toBe(200);
    expect(again.headers.get('location')).toBeNull();
    expect(await again.json()).toEqual(first);
    expect(await testDb.select().from(scheduleGroup)).toHaveLength(1);
  });

  it("answers 409 when the id is taken by a row this user can't see", async () => {
    const client = await signedIn();
    const [someone] = await testDb
      .insert(authUser)
      .values({ name: 'Someone', email: 'someone@example.com' })
      .returning();
    const taken = newId();
    await testDb
      .insert(scheduleGroup)
      .values({ id: taken, userId: someone?.id ?? '', name: 'Theirs', activeFrom: '2026-07-01' });

    const response = await client.post(GROUPS, groupBody({ id: taken }));
    expect(response.status).toBe(409);
    expect((await json<Problem>(response)).code).toBe('conflict');
    const [theirs] = await testDb.select().from(scheduleGroup);
    expect(theirs).toMatchObject({ id: taken, name: 'Theirs' });
  });

  it('refuses a body with missing or invalid fields, naming each', async () => {
    const client = await signedIn();
    const response = await client.post(GROUPS, {
      id: '00000000-0000-4000-8000-000000000000',
      name: '',
      colorToken: 'purple',
      activeFrom: '2026-07-13',
      activeTo: '2026-07-01',
    });
    expect(response.status).toBe(422);
    const problem = await json<Problem>(response);
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors?.map((error) => error.path).sort()).toEqual(['colorToken', 'id', 'name']);
  });

  it('refuses activeTo before activeFrom', async () => {
    const client = await signedIn();
    const response = await client.post(GROUPS, groupBody({ activeTo: '2026-07-01' }));
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).errors).toEqual([
      { path: 'activeTo', message: 'must be on or after activeFrom' },
    ]);
  });

  it('answers 400 when the body is not JSON', async () => {
    const client = await signedIn();
    const response = await client.post(GROUPS, '{"name": ');
    expect(response.status).toBe(400);
    expect((await json<Problem>(response)).code).toBe('malformed_request');
  });
});

describe('GET /api/v1/groups', () => {
  it('lists every group, oldest activeFrom first, then by name', async () => {
    const client = await signedIn();
    await create(client, { name: 'Health', activeFrom: '2026-07-01', activeTo: null });
    await create(client, { name: 'Classes · Sem 3 (sample)' });
    await create(client, { name: 'Clubs', activeFrom: '2026-07-13', activeTo: null });

    const response = await client.get(GROUPS);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { groups } = await json<GroupList>(response);
    expect(groups.map((group) => group.name)).toEqual([
      'Health',
      'Classes · Sem 3 (sample)',
      'Clubs',
    ]);
  });

  it('is an empty list for a new user', async () => {
    const client = await signedIn();
    expect(await json<GroupList>(await client.get(GROUPS))).toEqual({ groups: [] });
  });

  it('needs a session', async () => {
    const { app } = calendarTestApp();
    const response = await app.request(GROUPS);
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/groups/:id', () => {
  it('returns the group', async () => {
    const client = await signedIn();
    const group = await create(client);
    const response = await client.get(`${GROUPS}/${group.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(group);
  });

  it.each([
    ['an unknown id', newId()],
    ['a path id that is not a UUID', 'not-a-uuid'],
  ])('answers 404 for %s, still marked private', async (_, id) => {
    const client = await signedIn();
    const response = await client.get(`${GROUPS}/${id}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await json<Problem>(response)).toMatchObject({
      code: 'not_found',
      detail: 'No group with that id.',
    });
  });
});

describe('PATCH /api/v1/groups/:id', () => {
  it('changes only the fields sent', async () => {
    const client = await signedIn();
    const group = await create(client);
    const response = await client.patch(`${GROUPS}/${group.id}`, {
      name: 'Classes · Sem 3',
      colorToken: 'violet',
      activeTo: null,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...group,
      name: 'Classes · Sem 3',
      colorToken: 'violet',
      activeTo: null,
    });
  });

  it('answers an empty change with the group as it is', async () => {
    const client = await signedIn();
    const group = await create(client);
    const response = await client.patch(`${GROUPS}/${group.id}`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(group);
  });

  it('names activeTo when it would end before the stored activeFrom', async () => {
    const client = await signedIn();
    const group = await create(client);
    const response = await client.patch(`${GROUPS}/${group.id}`, { activeTo: '2026-07-01' });
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).errors).toEqual([
      { path: 'activeTo', message: 'must be on or after activeFrom' },
    ]);
  });

  it('names activeFrom when it would start after the stored activeTo', async () => {
    const client = await signedIn();
    const group = await create(client);
    const response = await client.patch(`${GROUPS}/${group.id}`, { activeFrom: '2026-12-01' });
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).errors).toEqual([
      { path: 'activeFrom', message: 'must be on or before activeTo' },
    ]);
    // Nothing changed.
    expect(await json<ScheduleGroup>(await client.get(`${GROUPS}/${group.id}`))).toEqual(group);
  });

  it('refuses invalid values and unknown ids', async () => {
    const client = await signedIn();
    const group = await create(client);
    const invalid = await client.patch(`${GROUPS}/${group.id}`, { attendanceThresholdPct: 101 });
    expect(invalid.status).toBe(422);
    expect((await json<Problem>(invalid)).errors?.[0]?.path).toBe('attendanceThresholdPct');

    expect((await client.patch(`${GROUPS}/${newId()}`, { name: 'x' })).status).toBe(404);
    expect((await client.patch(`${GROUPS}/nope`, { name: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/v1/groups/:id', () => {
  it('deletes the group, then answers 404 for it', async () => {
    const client = await signedIn();
    const group = await create(client);

    const response = await client.delete(`${GROUPS}/${group.id}`);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    expect((await client.get(`${GROUPS}/${group.id}`)).status).toBe(404);
    expect((await client.delete(`${GROUPS}/${group.id}`)).status).toBe(404);
  });
});
