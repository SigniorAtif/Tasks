import { useMutationState } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  nextWaitingAt,
  QUEUED_CHANGES,
  type QueueEntry,
  queueEntry,
  queueState,
} from './occurrence-queue.ts';

/**
 * The occurrence changes the server hasn't confirmed yet, oldest first,
 * re-rendering as they're queued, retried and confirmed, and when one on its
 * first try has taken long enough to count as waiting (`isWaiting`). The list
 * keeps its identity while nothing in it changes, so it's safe in a `useMemo`.
 */
export function useQueuedChanges(): QueueEntry[] {
  const states = useMutationState({ filters: QUEUED_CHANGES, select: queueState });
  // Time passing changes nothing in the mutation cache, so a timer redraws at
  // the moment the next quick try turns slow.
  const [now, setNow] = useState(Date.now);
  const next = nextWaitingAt(states, now);
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [next]);
  return useMemo(() => states.map((state) => queueEntry(state, now)), [states, now]);
}
