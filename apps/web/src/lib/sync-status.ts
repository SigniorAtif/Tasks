// What the "offline · last synced 2:02 PM" badge says (D-046), worked out from
// the query cache. Pure functions, so the rules can be tested without a browser.
//
// Two questions:
// 1. Are we offline? The browser's own flag (`navigator.onLine`, which TanStack
//    Query's `onlineManager` follows) only knows whether the phone has *a*
//    network. On campus Wi-Fi that needs a login page it says "online" while
//    every request fails. So the cache gets a vote too: if the newest fetch of
//    the calendar or the user failed with no answer at all, we're offline.
// 2. When did we last hear from the server? The newest successful fetch of the
//    calendar or the user, restored ones included.

import type { Query } from '@tanstack/react-query';
import type { IanaZone } from '@tasks/core';
import { NetworkError } from './api.ts';
import { isKnownZone } from './time.ts';

/** The parts of a cached query these rules read. A real `Query` fits. */
export interface CachedQuery {
  queryKey: Query['queryKey'];
  state: Pick<
    Query['state'],
    'status' | 'fetchStatus' | 'dataUpdatedAt' | 'errorUpdatedAt' | 'error' | 'fetchFailureReason'
  >;
}

export interface SyncStatus {
  /**
   * `synced`: online, and the newest fetch worked. `offline`: no network, or the
   * newest fetch got no answer. `failing`: the server answered with an error (a
   * 503 while it restarts, say).
   */
  state: 'synced' | 'offline' | 'failing';
  /** The newest successful fetch, in epoch ms. `null` if nothing was ever fetched. */
  lastSyncedAt: number | null;
}

/** The reads that show whether the calendar on screen is current. */
const WATCHED_KEYS: ReadonlySet<unknown> = new Set(['calendar', 'me']);

type Outcome = { at: number; result: 'ok' | 'no-answer' | 'error' };

/** How one query's latest fetch ended, and when. `null` if it never ended. */
function latestOutcome(state: CachedQuery['state']): Outcome | null {
  const result = (error: unknown) => (error instanceof NetworkError ? 'no-answer' : 'error');
  // Still fetching after a failed try (waiting to retry): that's the newest
  // news there is. `fetchFailureReason` alone isn't enough: it stays set after
  // the last try has failed too, when `status` already says `error`.
  if (state.fetchStatus !== 'idle' && state.fetchFailureReason != null) {
    return { at: Number.POSITIVE_INFINITY, result: result(state.fetchFailureReason) };
  }
  if (state.status === 'error') return { at: state.errorUpdatedAt, result: result(state.error) };
  if (state.status === 'success') return { at: state.dataUpdatedAt, result: 'ok' };
  return null;
}

/** Reads the badge's two answers from the cached queries. */
export function syncStatus(queries: readonly CachedQuery[], browserOnline: boolean): SyncStatus {
  let lastSyncedAt: number | null = null;
  let newest: Outcome | null = null;
  for (const query of queries) {
    if (!WATCHED_KEYS.has(query.queryKey[0])) continue;
    const { state } = query;
    if (state.dataUpdatedAt > 0) lastSyncedAt = Math.max(lastSyncedAt ?? 0, state.dataUpdatedAt);
    const outcome = latestOutcome(state);
    if (outcome !== null && (newest === null || outcome.at > newest.at)) newest = outcome;
  }

  let state: SyncStatus['state'] = 'synced';
  if (!browserOnline || newest?.result === 'no-answer') state = 'offline';
  else if (newest?.result === 'error') state = 'failing';
  return { state, lastSyncedAt };
}

/** `YYYY-MM-DD` of a moment in a zone, to tell whether two moments fall on the same day there. */
function dayIn(epochMs: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(epochMs);
}

/**
 * A moment as the badge shows it, on a 12-hour clock in `tzid` (B11): `2:02 PM`,
 * or `12 Oct, 2:02 PM` when it wasn't today. Without a known zone (nothing
 * cached yet), the phone's own zone.
 */
export function formatSyncedAt(epochMs: number, now: number, tzid?: IanaZone): string {
  const timeZone = tzid !== undefined && isKnownZone(tzid) ? tzid : undefined;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    day: 'numeric',
    month: 'short',
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  // Built from parts rather than taken whole: newer Intl versions put a narrow
  // no-break space before "PM", which would make the text differ by machine.
  const time = `${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
  if (dayIn(epochMs, timeZone) === dayIn(now, timeZone)) return time;
  return `${part('day')} ${part('month')}, ${time}`;
}

/** The badge's text, or `null` when there's nothing to say (online and up to date). */
export function syncBadgeText(status: SyncStatus, now: number, tzid?: IanaZone): string | null {
  if (status.state === 'synced') return null;
  const head = status.state === 'offline' ? 'offline' : "can't sync";
  if (status.lastSyncedAt === null) return head;
  return `${head} · last synced ${formatSyncedAt(status.lastSyncedAt, now, tzid)}`;
}
