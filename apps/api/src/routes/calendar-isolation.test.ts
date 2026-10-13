// Two people, one database: bob must not be able to read, change, delete or
// attach to anything of alice's, whatever ids he sends (D-016, A10). Both sign
// in through the real app. The first half goes through HTTP, as an attacker
// would; the second half shows row-level security doing its job underneath,
// for queries that forget to filter by user.

import type {
  CalendarResponse,
  GroupList,
  Problem,
  ScheduleGroup,
  Series,
  SeriesList,
} from '@tasks/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleGroup, series } from '../db/schema.ts';
import { withUser } from '../db/user-scope.ts';
import {
  alice,
  bob,
  type Client,
  calendarTestApp,
  groupBody,
  json,
  seriesBody,
  signIn,
} from '../test/calendar.ts';
import { resetDatabase, testDb } from '../test/database.ts';

const GROUPS = '/api/v1/groups';
const SERIES = '/api/v1/series';
const WEEK = '/api/v1/calendar?from=2026-10-12&to=2026-10-18';

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

interface World {
  asAlice: Client;
  asBob: Client;
  group: ScheduleGroup;
  ds: Series;
}

/** Alice and bob signed in; alice has a group with one series, bob has nothing. */
async function twoUsers(): Promise<World> {
  const test = calendarTestApp();
  const asAlice = await signIn(test, alice);
  const asBob = await signIn(test, bob);
  const group = await json<ScheduleGroup>(await asAlice.post(GROUPS, groupBody()));
  const ds = await json<Series>(await asAlice.post(SERIES, seriesBody(group.id)));
  return { asAlice, asBob, group, ds };
}

/** Alice's rows as the owner connection sees them (no row-level security). */
async function alicesRows() {
  return {
    groups: await testDb.select().from(scheduleGroup),
    series: await testDb.select().from(series),
  };
}

describe("bob, through the API, against alice's calendar", () => {
  it('sees empty lists and an empty calendar', async () => {
    const { asBob } = await twoUsers();
    expect(await json<GroupList>(await asBob.get(GROUPS))).toEqual({ groups: [] });
    expect(await json<SeriesList>(await asBob.get(SERIES))).toEqual({ series: [] });
    expect((await json<CalendarResponse>(await asBob.get(WEEK))).occurrences).toEqual([]);
  });

  it("gets 404 for reading, changing or deleting her rows, and they don't change", async () => {
    const { asAlice, asBob, group, ds } = await twoUsers();
    const before = await alicesRows();

    for (const path of [`${GROUPS}/${group.id}`, `${SERIES}/${ds.id}`]) {
      const reads = await asBob.get(path);
      const changes = await asBob.patch(path, { name: 'Mine now', title: 'Mine now' });
      const deletes = await asBob.delete(path);
      for (const response of [reads, changes, deletes]) {
        expect(response.status).toBe(404);
        expect((await json<Problem>(response)).code).toBe('not_found');
      }
    }
    // The same answer as an id that doesn't exist: nothing tells bob these are real.
    expect(await alicesRows()).toEqual(before);
    expect((await json<CalendarResponse>(await asAlice.get(WEEK))).occurrences).toHaveLength(3);
  });

  it('gets 422 on groupId for a series in her group', async () => {
    const { asBob, group } = await twoUsers();
    const response = await asBob.post(SERIES, seriesBody(group.id));
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).errors).toEqual([
      { path: 'groupId', message: 'must be one of your groups' },
    ]);
    expect(await testDb.select().from(series)).toHaveLength(1);
  });

  it('gets 409 for creating rows with her ids, and her rows stay as they were', async () => {
    const { asBob, group, ds } = await twoUsers();
    const before = await alicesRows();
    const bobsGroup = await json<ScheduleGroup>(
      await asBob.post(GROUPS, groupBody({ name: 'Health' })),
    );

    const groupResponse = await asBob.post(GROUPS, groupBody({ id: group.id, name: 'Mine' }));
    const seriesResponse = await asBob.post(SERIES, seriesBody(bobsGroup.id, { id: ds.id }));
    expect(groupResponse.status).toBe(409);
    expect(seriesResponse.status).toBe(409);
    expect((await json<Problem>(groupResponse)).code).toBe('conflict');

    const after = await alicesRows();
    expect(after.groups.find((row) => row.id === group.id)).toEqual(before.groups[0]);
    expect(after.series).toEqual(before.series);
  });

  it("can't move his own series into her group", async () => {
    const { asBob, group } = await twoUsers();
    const bobsGroup = await json<ScheduleGroup>(
      await asBob.post(GROUPS, groupBody({ name: 'Health' })),
    );
    const bobsSeries = await json<Series>(await asBob.post(SERIES, seriesBody(bobsGroup.id)));
    const response = await asBob.patch(`${SERIES}/${bobsSeries.id}`, { groupId: group.id });
    expect(response.status).toBe(422);
    expect((await json<Problem>(response)).errors?.[0]?.path).toBe('groupId');
  });
});

describe('row-level security under the repositories', () => {
  it('shows bob only his own rows, even to a query with no WHERE at all', async () => {
    const { asBob } = await twoUsers();
    const bobsGroup = await json<ScheduleGroup>(
      await asBob.post(GROUPS, groupBody({ name: 'Health' })),
    );
    await asBob.post(SERIES, seriesBody(bobsGroup.id, { title: 'Evening run' }));

    const seenByBob = await withUser(testDb, asBob.userId, ({ tx }) => tx.select().from(series));
    expect(seenByBob.map((row) => [row.title, row.userId])).toEqual([
      ['Evening run', asBob.userId],
    ]);
    // The owner connection (migrations, tests) sees both users' rows.
    expect(await testDb.select().from(series)).toHaveLength(2);
  });

  it('hides her rows from queries that filter by id only, and blocks writes to them', async () => {
    const { asBob, group, ds } = await twoUsers();
    const byIdOnly = await withUser(testDb, asBob.userId, async ({ tx }) => ({
      found: await tx.select().from(scheduleGroup).where(eq(scheduleGroup.id, group.id)),
      renamed: await tx
        .update(series)
        .set({ title: 'Mine now' })
        .where(eq(series.id, ds.id))
        .returning(),
      deleted: await tx.delete(scheduleGroup).where(eq(scheduleGroup.id, group.id)).returning(),
    }));
    expect(byIdOnly).toEqual({ found: [], renamed: [], deleted: [] });
    const [still] = await testDb.select().from(series).where(eq(series.id, ds.id));
    expect(still?.title).toBe('Data Structures');
  });
});
