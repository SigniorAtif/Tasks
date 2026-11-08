// Cancel, restore and change reason, queued so they work with no signal (#9).
//
// Every other write is online-only (D-048). These three are TanStack Query
// mutations under one key, `OCCURRENCE_CHANGE`, whose options are registered on
// the client at startup (`setMutationDefaults`) instead of in a component. That
// matters after a reload: a queued change restored from the phone's copy
// (persist.ts) is only a key and its variables, and finds its request, its
// retry rule and what to do afterwards here.
//
// How a queued change travels:
// - Offline it waits, "paused", until the browser says it's back online.
// - All of them share one scope, so they're sent one at a time in the order
//   they were made. The newest change to an occurrence arrives last and stays.
// - No answer, a 5xx, a 401, 408 or 429, or a page that isn't the API's answer
//   (Wi-Fi that wants you to log in first) means "try again later": after 1 s,
//   2 s, 4 s and so on, at most 30 s apart (TanStack Query's default backoff).
//   A 401 means the session ended; the change keeps waiting, the calendar is
//   fetched again so the screen meets the 401 and goes to sign in, and the
//   change goes through once you have (signing in reloads the app, which sends
//   the queue).
// - Any other 4xx can't be fixed by asking again. A 404 means the series was
//   deleted or no longer has that date. The change is dropped, so the calendar
//   stops showing it, the weeks are fetched again, and the screen says so.
//   An error from the app itself is dropped the same way, since a change that
//   can never be sent would hold every change behind it.
//
// The queue lives in one tab: the app runs in one tab at a time (one-tab.ts),
// because two tabs would each save their own queue over the other's, and a
// change made offline in one could vanish. Sending a change twice would be
// harmless (the request is idempotent, D-042); losing one isn't.

import type { Mutation, QueryClient } from '@tanstack/react-query';
import type { Occurrence } from '@tasks/core';
import { ApiError, isUnauthenticated, NetworkError } from './api.ts';
import { changeOccurrence, type OccurrenceChange, putOccurrence } from './mutations.ts';

/** The mutation key every queued occurrence change shares. */
const OCCURRENCE_CHANGE = ['occurrence-change'] as const;

/** Every cached calendar window. */
const CALENDAR = ['calendar'] as const;

/**
 * How long a change's first try may take before it's marked as waiting anyway.
 * On a signal too weak to carry it, the phone still says "online", and a
 * request can hang for minutes.
 */
const SLOW_MS = 2_000;

/** One queue: changes in the same scope are sent one after another, never side by side. */
const QUEUE_SCOPE = { id: 'occurrence-changes' };

/** A change to one occurrence, as it waits in the queue. */
export interface QueuedChange extends OccurrenceChange {
  /** The class's title, for messages about this change. Never sent. */
  title: string;
}

/** A queued change and how its sending is going, as the mutation cache knows it. */
export interface QueueState extends QueuedChange {
  /** Paused offline, or already failed at least once. */
  stuck: boolean;
  /** When it was first sent, in epoch ms. */
  sentAt: number;
}

/** A queued change and whether it's visibly waiting (`isWaiting`). */
export interface QueueEntry extends QueuedChange {
  waiting: boolean;
}

/** A change the server refused for good. */
export interface DroppedChange extends QueuedChange {
  /** A 404: the series was deleted, or no longer has that date. */
  gone: boolean;
}

/** Statuses worth asking again: no session yet, a timeout, too many requests. */
const RETRIED_4XX: ReadonlySet<number> = new Set([401, 408, 429]);

/**
 * Whether a failed try is worth repeating: no answer, a 5xx, one of the three
 * 4xx above, or a success that isn't JSON (a Wi-Fi login page answered instead
 * of the API). Not any other 4xx: the server has said no, and will say it
 * again. Not an error from the app itself either: it would fail every time.
 */
export function shouldRetryChange(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (!(error instanceof ApiError)) return false;
  if (error.status < 400 || error.status >= 500) return true;
  return RETRIED_4XX.has(error.status);
}

/** Drops nobody has been told about yet, and who is listening, per client. */
const dropLines = new WeakMap<
  QueryClient,
  { unheard: DroppedChange[]; listeners: Set<(dropped: DroppedChange) => void> }
>();

function dropLine(queryClient: QueryClient) {
  let line = dropLines.get(queryClient);
  if (line === undefined) {
    line = { unheard: [], listeners: new Set() };
    dropLines.set(queryClient, line);
  }
  return line;
}

/** Fetches the cached weeks again: the active ones now, the rest when next shown. */
const refetchCalendar = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: CALENDAR });

/**
 * Teaches `queryClient` how to send a queued change. Call it before the saved
 * copy is restored, so restored changes find these options too.
 */
export function registerOccurrenceChanges(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<Occurrence, Error, QueuedChange>(OCCURRENCE_CHANGE, {
    mutationFn: changeOccurrence,
    // Wait while offline, unlike every other write (query-client.ts).
    networkMode: 'online',
    scope: QUEUE_SCOPE,
    retry: (_failures, error) => shouldRetryChange(error),
    onSuccess: (occurrence) => {
      putOccurrence(queryClient, occurrence);
      // A fetch of the weeks that set off before the server had this change
      // would land after it and draw the old state over it. Fetch those again,
      // which cancels them.
      void queryClient.refetchQueries({ queryKey: CALENDAR, fetchStatus: 'fetching' });
    },
    // Not awaited: the screen should hear about the drop now, not after the refetch.
    onError: () => void refetchCalendar(queryClient),
  });

  queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || !isOccurrenceChange(event.mutation)) return;
    const { action } = event;
    // A try that met a 401: the session is gone. A change is no read, so
    // nothing on screen noticed; fetching the weeks again makes the screen meet
    // the 401 too, and send you to sign in.
    if (action.type === 'failed' && isUnauthenticated(action.error)) {
      void refetchCalendar(queryClient);
    }
    // Dropped for good. Told to whoever listens, or kept for the next screen
    // that does: a drop while you're on another screen still gets its toast.
    if (action.type === 'error') {
      const dropped = {
        ...(event.mutation.state.variables as QueuedChange),
        gone: action.error instanceof ApiError && action.error.status === 404,
      };
      const line = dropLine(queryClient);
      if (line.listeners.size === 0) line.unheard.push(dropped);
      for (const listener of line.listeners) listener(dropped);
    }
  });
}

/**
 * Queues a change and sends it as soon as it can. The calendar shows it at
 * once (calendar/model/queued.ts). Never throws: a refused change is reported
 * through `onChangeDropped`.
 */
export function queueOccurrenceChange(queryClient: QueryClient, change: QueuedChange): void {
  queryClient
    .getMutationCache()
    .build<Occurrence, Error, QueuedChange, unknown>(queryClient, {
      mutationKey: OCCURRENCE_CHANGE,
    })
    .execute(change)
    .catch(() => {
      // Dropped: `onError` above and `onChangeDropped` deal with it.
    });
}

/** Finds the changes the server hasn't confirmed yet. Paused ones count. */
export const QUEUED_CHANGES = { mutationKey: OCCURRENCE_CHANGE, status: 'pending' } as const;

/** Whether `mutation` is a change to one occurrence, in whatever state. */
function isOccurrenceChange(mutation: Mutation): boolean {
  return mutation.options.mutationKey?.[0] === OCCURRENCE_CHANGE[0];
}

/** Whether `mutation` is a queued change the server hasn't confirmed yet. */
export function isQueuedChange(mutation: Mutation): boolean {
  return isOccurrenceChange(mutation) && mutation.state.status === QUEUED_CHANGES.status;
}

/** A queued change and how its sending is going. */
export function queueState(mutation: Mutation): QueueState {
  const { variables, isPaused, failureCount, submittedAt } = mutation.state;
  return {
    ...(variables as QueuedChange),
    stuck: isPaused || failureCount > 0,
    sentAt: submittedAt,
  };
}

/**
 * Whether a queued change shows as waiting at `now`: paused, failed at least
 * once, or on its first try for 2 s. So a tap with good signal doesn't flash a
 * mark, and a request hanging on a weak one still gets it.
 */
export function isWaiting(change: QueueState, now: number): boolean {
  return change.stuck || now - change.sentAt >= SLOW_MS;
}

/** When the next of `changes` turns waiting, or `null` if none will by waiting longer. */
export function nextWaitingAt(changes: readonly QueueState[], now: number): number | null {
  const times = changes.filter((c) => !isWaiting(c, now)).map((c) => c.sentAt + SLOW_MS);
  return times.length === 0 ? null : Math.min(...times);
}

/** A queued change as the screen sees it at `now`. */
export function queueEntry(state: QueueState, now: number): QueueEntry {
  const { stuck: _stuck, sentAt: _sentAt, ...change } = state;
  return { ...change, waiting: isWaiting(state, now) };
}

/** Every change the server hasn't confirmed yet, oldest first. */
export function queuedChanges(queryClient: QueryClient): QueueEntry[] {
  const now = Date.now();
  return queryClient
    .getMutationCache()
    .findAll(QUEUED_CHANGES)
    .map((mutation) => queueEntry(queueState(mutation), now));
}

/**
 * Sends the queue restored from the phone's copy, in order, then fetches the
 * weeks again: one fetched while the changes were on their way may predate
 * them. Call it once the saved copy is back. Offline it waits for the network.
 */
export async function sendQueuedChanges(queryClient: QueryClient): Promise<void> {
  if (queuedChanges(queryClient).length === 0) return;
  await queryClient.resumePausedMutations();
  await refetchCalendar(queryClient);
}

/**
 * What Sign out says first when changes are still queued, or `null` when none
 * are. Signing out forgets everything on the phone, queue included, so without
 * this a cancel made offline would vanish silently (spec #6, edge case 1).
 */
export function signOutWarning(queued: number): string | null {
  if (queued === 0) return null;
  return queued === 1
    ? "1 change hasn't synced. Sign out anyway? It'll be lost."
    : `${queued} changes haven't synced. Sign out anyway? They'll be lost.`;
}

/**
 * Calls `listener` each time the server refuses a queued change for good,
 * starting with any drops made while nobody was listening. Returns the
 * function that stops listening.
 */
export function onChangeDropped(
  queryClient: QueryClient,
  listener: (dropped: DroppedChange) => void,
): () => void {
  const line = dropLine(queryClient);
  for (const dropped of line.unheard.splice(0)) listener(dropped);
  line.listeners.add(listener);
  return () => line.listeners.delete(listener);
}
