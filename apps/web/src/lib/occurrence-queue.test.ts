import { onlineManager } from '@tanstack/react-query';
import type { CalendarResponse, UpdateOccurrence } from '@tasks/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrence } from '../calendar/model/test-builders.ts';
import { ApiError, NetworkError } from './api.ts';
import {
  type DroppedChange,
  onChangeDropped,
  type QueuedChange,
  queuedChanges,
  queueOccurrenceChange,
  sendQueuedChanges,
  shouldRetryChange,
  signOutWarning,
} from './occurrence-queue.ts';
import { createQueryClient } from './query-client.ts';

const WEEK = ['calendar', '2026-10-05', '2026-10-11'];
/** Tuesday's DS class, as the server first sent it. */
const DS = occurrence();

const SKIP: UpdateOccurrence = { status: 'cancelled', cancelReason: 'skipped' };
const PROF: UpdateOccurrence = { status: 'cancelled', cancelReason: 'not_held' };
const RESTORE: UpdateOccurrence = { status: null, cancelReason: null };

/** A change to Tuesday's DS class. */
const toDS = (change: UpdateOccurrence): QueuedChange => ({
  seriesId: DS.seriesId,
  originalDate: '2026-10-06',
  title: DS.title,
  change,
});

/** DS as the server computes it after `change`. */
const answerTo = (change: UpdateOccurrence) =>
  change.status === 'cancelled'
    ? occurrence({ status: 'cancelled', cancelReason: change.cancelReason, cancelOrigin: 'user' })
    : occurrence();

type Reply = number | 'no answer' | 'no reply yet';

/** The error code the API sends with each status. */
const CODES: Record<number, string> = {
  401: 'unauthenticated',
  404: 'not_found',
  422: 'validation_failed',
};

/**
 * A stand-in for the API. Each request takes the next reply in turn: an HTTP
 * status, 'no answer' for a request that never reaches it, or 'no reply yet'
 * for one that reaches it and hangs (a weak signal). Once they run
 * out, every request gets `otherwise` (200 unless a test changes it). `sent`
 * is each body that reached it, in order.
 */
function fakeServer(...replies: Reply[]) {
  const server = { sent: [] as UpdateOccurrence[], otherwise: 200 as Reply };
  const { sent } = server;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: RequestInit) => {
      const reply = replies.shift() ?? server.otherwise;
      if (reply === 'no answer') throw new TypeError('Failed to fetch');
      const body = JSON.parse(String(init.body)) as UpdateOccurrence;
      sent.push(body);
      if (reply === 'no reply yet') return new Promise<Response>(() => {});
      if (reply === 200) return Response.json(answerTo(body));
      return Response.json(
        { code: CODES[reply] ?? 'internal_error', title: `HTTP ${reply}` },
        { status: reply, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }),
  );
  return server;
}

/** A client holding DS's week, mounted like the app's, so it hears the browser go online. */
function setup() {
  const client = createQueryClient();
  client.setQueryData<CalendarResponse>(WEEK, {
    from: '2026-10-05',
    to: '2026-10-11',
    occurrences: [DS],
  });
  client.mount();
  const dropped: DroppedChange[] = [];
  onChangeDropped(client, (change) => dropped.push(change));
  return { client, dropped, week: () => client.getQueryData<CalendarResponse>(WEEK) };
}

/** Lets every timer due in the next `ms` run, with the promises they start. */
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a queued change', () => {
  it('waits while offline, then reaches the server and the calendar once back online', async () => {
    const server = fakeServer();
    const { client, week } = setup();
    onlineManager.setOnline(false);

    queueOccurrenceChange(client, toDS(SKIP));
    await wait(60_000);
    expect(server.sent).toEqual([]);
    expect(queuedChanges(client)).toEqual([{ ...toDS(SKIP), waiting: true }]);

    onlineManager.setOnline(true);
    await wait(0);
    expect(server.sent).toEqual([SKIP]);
    expect(queuedChanges(client)).toEqual([]);
    expect(week()?.occurrences).toEqual([answerTo(SKIP)]);
  });
});

describe('replaying the queue', () => {
  it('sends changes one at a time in the order they were made, so the newest stays', async () => {
    const server = fakeServer();
    const { client, week } = setup();
    onlineManager.setOnline(false);

    queueOccurrenceChange(client, toDS(SKIP));
    queueOccurrenceChange(client, toDS(PROF));
    queueOccurrenceChange(client, toDS(RESTORE));
    onlineManager.setOnline(true);
    await wait(0);

    expect(server.sent).toEqual([SKIP, PROF, RESTORE]);
    expect(week()?.occurrences).toEqual([answerTo(RESTORE)]);
  });

  it('is not waiting on its first try online, so a tap with signal shows no mark', () => {
    fakeServer();
    const { client } = setup();
    queueOccurrenceChange(client, toDS(SKIP));
    expect(queuedChanges(client)).toEqual([{ ...toDS(SKIP), waiting: false }]);
  });

  it('is waiting once its first try has taken 2 s, as on a signal too weak to answer', async () => {
    fakeServer('no reply yet');
    const { client } = setup();
    queueOccurrenceChange(client, toDS(SKIP));
    await wait(1_999);
    expect(queuedChanges(client)).toEqual([{ ...toDS(SKIP), waiting: false }]);
    await wait(1);
    expect(queuedChanges(client)).toEqual([{ ...toDS(SKIP), waiting: true }]);
  });

  it("can't be undone on screen by a fetch of the week that read it before the change", async () => {
    fakeServer();
    const { client, week } = setup();
    // The server's week, as each fetch finds it: the first started before the
    // change reached the server and takes 5 s to come back.
    let reads = 0;
    const readWeek = (): Promise<CalendarResponse> => {
      reads += 1;
      const occurrences = reads === 1 ? [DS] : [answerTo(SKIP)];
      const answer = { from: '2026-10-05', to: '2026-10-11', occurrences };
      return new Promise((resolve) => setTimeout(() => resolve(answer), reads === 1 ? 5_000 : 0));
    };
    client.fetchQuery({ queryKey: WEEK, queryFn: readWeek, staleTime: 0 }).catch(() => {});

    queueOccurrenceChange(client, toDS(SKIP));
    await wait(10_000);
    expect(week()?.occurrences).toEqual([answerTo(SKIP)]);
  });

  it('drops a change the server says no longer exists, and fetches the weeks again', async () => {
    const server = fakeServer(404);
    const { client, dropped } = setup();

    queueOccurrenceChange(client, toDS(SKIP));
    await wait(60_000);

    expect(server.sent).toEqual([SKIP]);
    expect(queuedChanges(client)).toEqual([]);
    expect(dropped).toEqual([{ ...toDS(SKIP), gone: true }]);
    expect(client.getQueryState(WEEK)?.isInvalidated).toBe(true);
  });

  it('drops any other refusal too, without saying the class is gone', async () => {
    fakeServer(422);
    const { client, dropped } = setup();
    queueOccurrenceChange(client, toDS(SKIP));
    await wait(0);
    expect(dropped).toEqual([{ ...toDS(SKIP), gone: false }]);
  });

  it('keeps trying after no answer and 5xx, waiting longer each time', async () => {
    const server = fakeServer('no answer', 503, 500);
    const { client, week } = setup();

    queueOccurrenceChange(client, toDS(SKIP));
    await wait(0);
    expect(queuedChanges(client)).toEqual([{ ...toDS(SKIP), waiting: true }]);
    await wait(1_000 + 2_000);
    expect(server.sent).toEqual([SKIP, SKIP]);
    await wait(4_000);

    expect(server.sent).toEqual([SKIP, SKIP, SKIP]);
    expect(queuedChanges(client)).toEqual([]);
    expect(week()?.occurrences).toEqual([answerTo(SKIP)]);
  });

  it('keeps a change while the session is gone, and sends it once it is back', async () => {
    const server = fakeServer();
    server.otherwise = 401;
    const { client, dropped, week } = setup();

    queueOccurrenceChange(client, toDS(SKIP));
    await wait(10 * 60_000);
    expect(queuedChanges(client)).toEqual([{ ...toDS(SKIP), waiting: true }]);
    expect(dropped).toEqual([]);
    // The weeks are asked for again, so the screen meets the 401 and goes to sign in.
    expect(client.getQueryState(WEEK)?.isInvalidated).toBe(true);

    // Signed in again: the next try, at most 30 s later, goes through.
    server.otherwise = 200;
    await wait(30_000);
    expect(queuedChanges(client)).toEqual([]);
    expect(week()?.occurrences).toEqual([answerTo(SKIP)]);
  });

  it('holds later changes behind one that keeps failing, so the order survives', async () => {
    const server = fakeServer(503);
    const { client, week } = setup();

    queueOccurrenceChange(client, toDS(SKIP));
    queueOccurrenceChange(client, toDS(RESTORE));
    await wait(0);
    expect(server.sent).toEqual([SKIP]);
    await wait(1_000);

    expect(server.sent).toEqual([SKIP, SKIP, RESTORE]);
    expect(week()?.occurrences).toEqual([answerTo(RESTORE)]);
  });
});

describe('onChangeDropped', () => {
  it('tells the next screen to listen about a change dropped while none was', async () => {
    fakeServer(404);
    const client = createQueryClient();
    client.mount();
    queueOccurrenceChange(client, toDS(SKIP));
    await wait(0);

    const heard: DroppedChange[] = [];
    onChangeDropped(client, (change) => heard.push(change));
    expect(heard).toEqual([{ ...toDS(SKIP), gone: true }]);

    const later: DroppedChange[] = [];
    onChangeDropped(client, (change) => later.push(change));
    expect(later).toEqual([]);
  });
});

describe('shouldRetryChange', () => {
  it('asks again after no answer, a 5xx, a page that is not the API, or the three 4xx that pass', () => {
    const status = (code: number) =>
      new ApiError({ status: code, code: 'internal_error', title: '' });
    expect(shouldRetryChange(new NetworkError())).toBe(true);
    for (const code of [200, 401, 408, 429, 500, 503])
      expect(shouldRetryChange(status(code))).toBe(true);
    for (const code of [400, 403, 404, 409, 422])
      expect(shouldRetryChange(status(code))).toBe(false);
  });

  it('gives up on an error that is neither the network nor the server: asking again would hold the queue forever', () => {
    expect(shouldRetryChange(new TypeError('x is undefined'))).toBe(false);
  });
});

describe('sendQueuedChanges', () => {
  it('sends the restored queue in order, then fetches the weeks again', async () => {
    const server = fakeServer();
    const client = createQueryClient();
    client.setQueryData(WEEK, { from: '2026-10-05', to: '2026-10-11', occurrences: [DS] });
    onlineManager.setOnline(false);
    queueOccurrenceChange(client, toDS(SKIP));
    queueOccurrenceChange(client, toDS(RESTORE));
    onlineManager.setOnline(true);

    await sendQueuedChanges(client);

    expect(server.sent).toEqual([SKIP, RESTORE]);
    // A week fetched while they were on their way may predate them.
    expect(client.getQueryState(WEEK)?.isInvalidated).toBe(true);
  });

  it('fetches nothing again when nothing was queued', async () => {
    const client = createQueryClient();
    client.setQueryData(WEEK, { from: '2026-10-05', to: '2026-10-11', occurrences: [DS] });
    await sendQueuedChanges(client);
    expect(client.getQueryState(WEEK)?.isInvalidated).toBe(false);
  });
});

describe('signOutWarning', () => {
  it('says nothing when every change has reached the server', () => {
    expect(signOutWarning(0)).toBeNull();
  });

  it('warns that signing out loses the changes still queued (spec #6, edge case 1)', () => {
    expect(signOutWarning(1)).toBe("1 change hasn't synced. Sign out anyway? It'll be lost.");
    expect(signOutWarning(3)).toBe("3 changes haven't synced. Sign out anyway? They'll be lost.");
  });
});
