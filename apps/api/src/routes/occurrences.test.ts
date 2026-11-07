import type {
  CalendarResponse,
  Occurrence,
  Problem,
  ScheduleGroup,
  Series,
  UpdateOccurrence,
} from '@tasks/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceOverride } from '../db/schema.ts';
import {
  alice,
  type Client,
  calendarTestApp,
  groupBody,
  json,
  seriesBody,
  signIn,
} from '../test/calendar.ts';
import { resetDatabase, testDb } from '../test/database.ts';

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

const occurrencePath = (seriesId: string, originalDate: string) =>
  `/api/v1/occurrences/${seriesId}/${originalDate}`;

/** The calendar's occurrence for this series' `originalDate`, found on the day it shows on. */
async function onCalendar(
  client: Client,
  seriesId: string,
  originalDate: string,
  shownOn = originalDate,
): Promise<Occurrence> {
  const response = await client.get(`/api/v1/calendar?from=${shownOn}&to=${shownOn}`);
  const { occurrences } = await json<CalendarResponse>(response);
  const found = occurrences.find((o) => o.key === `${seriesId}:${originalDate}`);
  if (!found) throw new Error(`${seriesId}:${originalDate} isn't on the calendar on ${shownOn}`);
  return found;
}

// Wednesday 14 October 2026: Data Structures is on.
const WEDNESDAY = '2026-10-14';

const PROF: UpdateOccurrence = { status: 'cancelled', cancelReason: 'not_held' };
const ME: UpdateOccurrence = { status: 'cancelled', cancelReason: 'skipped' };
const NOT_TODAY: UpdateOccurrence = { status: 'cancelled', cancelReason: null };
const RESTORE: UpdateOccurrence = { status: null, cancelReason: null };

/** Every override row, as the owner connection sees them. */
const overrideRows = () => testDb.select().from(occurrenceOverride);

describe('PATCH /api/v1/occurrences/:seriesId/:originalDate', () => {
  it('cancels one occurrence and answers with it as the calendar now shows it', async () => {
    const { client, ds } = await withTimetable();

    const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), PROF);

    expect(response.status).toBe(200);
    const answer = await json<Occurrence>(response);
    expect(answer).toMatchObject({
      key: `${ds.id}:${WEDNESDAY}`,
      date: WEDNESDAY,
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'user',
    });
    expect(answer).toEqual(await onCalendar(client, ds.id, WEDNESDAY));
  });

  it('changes the reason of a cancelled occurrence without restoring it first', async () => {
    const { client, ds } = await withTimetable();
    await client.patch(occurrencePath(ds.id, WEDNESDAY), PROF);

    const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), ME);

    expect(response.status).toBe(200);
    expect(await json<Occurrence>(response)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'skipped',
    });
    expect(await onCalendar(client, ds.id, WEDNESDAY)).toMatchObject({ cancelReason: 'skipped' });
    expect(await overrideRows()).toHaveLength(1);
  });

  it('cancels with no reason, for groups without attendance', async () => {
    const { client, ds } = await withTimetable();
    const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), NOT_TODAY);
    expect(await json<Occurrence>(response)).toMatchObject({
      status: 'cancelled',
      cancelReason: null,
      cancelOrigin: 'user',
    });
  });

  it('restores a cancelled occurrence and removes the row that said nothing else', async () => {
    const { client, ds } = await withTimetable();
    await client.patch(occurrencePath(ds.id, WEDNESDAY), ME);

    const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), RESTORE);

    expect(response.status).toBe(200);
    const answer = await json<Occurrence>(response);
    expect(answer).toMatchObject({ status: 'scheduled', cancelReason: null, cancelOrigin: null });
    expect(answer).toEqual(await onCalendar(client, ds.id, WEDNESDAY));
    // The client never knows whether a row exists; the server keeps none that's empty.
    expect(await overrideRows()).toEqual([]);
  });

  it('keeps the note when restoring an occurrence that has one', async () => {
    const { client, ds } = await withTimetable();
    // Nothing writes notes until v0.3b, so the test writes this one directly.
    await testDb.insert(occurrenceOverride).values({
      userId: client.userId,
      seriesId: ds.id,
      kind: 'modified',
      originalDate: WEDNESDAY,
      status: 'cancelled',
      cancelReason: 'not_held',
      note: 'Bring the lab manual',
    });

    const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), RESTORE);

    expect(await json<Occurrence>(response)).toMatchObject({
      status: 'scheduled',
      note: 'Bring the lab manual',
    });
    expect(await overrideRows()).toHaveLength(1);
  });

  it('works on past occurrences and on an occurrence moved to another day', async () => {
    const { client, ds } = await withTimetable();
    // Friday 9 October moved to Saturday at 10:00 (v0.3b writes moves; the test writes it).
    await testDb.insert(occurrenceOverride).values({
      userId: client.userId,
      seriesId: ds.id,
      kind: 'modified',
      originalDate: '2026-10-09',
      newDate: '2026-10-10',
      newStartTime: '10:00',
    });

    const moved = await client.patch(occurrencePath(ds.id, '2026-10-09'), ME);
    const past = await client.patch(occurrencePath(ds.id, '2026-07-13'), PROF);

    const answer = await json<Occurrence>(moved);
    expect(answer).toMatchObject({ date: '2026-10-10', moved: true, status: 'cancelled' });
    expect(answer).toEqual(await onCalendar(client, ds.id, '2026-10-09', '2026-10-10'));
    expect(past.status).toBe(200);
    // A restore keeps the move: only the status and the reason change.
    await client.patch(occurrencePath(ds.id, '2026-10-09'), RESTORE);
    expect(await onCalendar(client, ds.id, '2026-10-09', '2026-10-10')).toMatchObject({
      status: 'scheduled',
      moved: true,
    });
  });

  it('leaves the same state and gives the same answer when the same body comes twice', async () => {
    const { client, ds } = await withTimetable();
    const path = occurrencePath(ds.id, WEDNESDAY);

    for (const body of [ME, RESTORE]) {
      const first = await client.patch(path, body);
      const firstRows = await overrideRows();
      const second = await client.patch(path, body);

      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect((await overrideRows()).map(({ updatedAt, ...row }) => row)).toEqual(
        firstRows.map(({ updatedAt, ...row }) => row),
      );
    }
  });

  it('copes with many requests for one occurrence at the same moment', async () => {
    const { client, ds } = await withTimetable();
    const path = occurrencePath(ds.id, WEDNESDAY);

    // Nobody has a row yet, so every one of these tries to create it.
    const cancels = await Promise.all(
      [PROF, ME, PROF, ME, PROF, ME].map((b) => client.patch(path, b)),
    );
    expect(cancels.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await overrideRows()).toHaveLength(1);

    const restores = await Promise.all([1, 2, 3, 4].map(() => client.patch(path, RESTORE)));
    expect(restores.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await overrideRows()).toEqual([]);

    // Cancels and restores racing: whichever lands last wins, and no empty row is left.
    const mixed = await Promise.all(
      [PROF, RESTORE, ME, RESTORE, NOT_TODAY, RESTORE].map((b) => client.patch(path, b)),
    );
    expect(mixed.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const left = await overrideRows();
    expect(left.length).toBeLessThanOrEqual(1);
    for (const row of left) expect(row.status).toBe('cancelled');
  });

  it("doesn't check the reason against the group's attendance, and keeps reasons when it changes", async () => {
    const { client, group, ds } = await withTimetable();
    await client.patch(`/api/v1/groups/${group.id}`, { attendance: false });

    // The sheet offers only "Not today" here, but the server takes a reason anyway.
    const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), ME);
    expect(response.status).toBe(200);

    await client.patch(`/api/v1/groups/${group.id}`, { attendance: true });
    await client.patch(`/api/v1/groups/${group.id}`, { attendance: false });
    expect(await onCalendar(client, ds.id, WEDNESDAY)).toMatchObject({ cancelReason: 'skipped' });
  });

  describe('answers 404 not_found', () => {
    it('for a series that does not exist, or an id or date that cannot be one', async () => {
      const { client, ds } = await withTimetable();
      const paths = [
        occurrencePath('0198f7a2-0000-7000-8000-000000000000', WEDNESDAY),
        occurrencePath('not-a-uuid', WEDNESDAY),
        occurrencePath(ds.id, '2026-02-30'),
        occurrencePath(ds.id, 'tomorrow'),
      ];
      for (const path of paths) {
        const response = await client.patch(path, PROF);
        expect(response.status, path).toBe(404);
        expect((await json<Problem>(response)).code).toBe('not_found');
      }
    });

    it('for a date the series never generates', async () => {
      const { client, group } = await withTimetable();
      // Mon, Wed, Fri from Monday 13 July to Friday 30 October.
      const ds = await json<Series>(
        await client.post('/api/v1/series', seriesBody(group.id, { untilDate: '2026-10-30' })),
      );
      const never = [
        '2026-10-13', // a Tuesday: not on its rule
        '2026-07-10', // a Friday before its first day
        '2026-11-02', // a Monday after its last day
      ];
      for (const date of never) {
        const response = await client.patch(occurrencePath(ds.id, date), PROF);
        expect(response.status, date).toBe(404);
      }
      expect(await overrideRows()).toEqual([]);
    });

    it("for a date after the group's last day", async () => {
      const { client, ds } = await withTimetable();
      // The sample group ends on Friday 27 November; Monday 30th is after it.
      const response = await client.patch(occurrencePath(ds.id, '2026-11-30'), PROF);
      expect(response.status).toBe(404);
    });
  });

  describe('answers 422 validation_failed', () => {
    it('for a reason without a cancel', async () => {
      const { client, ds } = await withTimetable();
      const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), {
        status: null,
        cancelReason: 'skipped',
      });
      expect(response.status).toBe(422);
      expect(await json<Problem>(response)).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'cancelReason', message: 'must be null unless status is cancelled' }],
      });
      expect(await overrideRows()).toEqual([]);
    });

    it('for a status or reason it does not know, or a missing field', async () => {
      const { client, ds } = await withTimetable();
      const bodies = [
        { status: 'scheduled', cancelReason: null },
        { status: 'cancelled', cancelReason: 'holiday' },
        { status: 'cancelled' },
      ];
      for (const body of bodies) {
        const response = await client.patch(occurrencePath(ds.id, WEDNESDAY), body);
        expect(response.status, JSON.stringify(body)).toBe(422);
      }
    });
  });
});
