import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { type SyncStatus, syncStatus } from './sync-status.ts';
import { useOnline } from './use-online.ts';

/**
 * Whether the app is in touch with the server, and when it last was (see
 * sync-status.ts), re-rendering when either changes. The badge shows it, and
 * the forms use it to turn Save off, so the two always agree: a cold open with
 * no signal says "offline" in both places even before the browser does.
 */
export function useSyncStatus(): SyncStatus {
  const queryClient = useQueryClient();
  const online = useOnline();

  // Re-read the cache whenever any query in it changes (a fetch starts, works
  // or fails). Each snapshot is a plain value, so React re-renders only when
  // the value itself changes.
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const read = () => syncStatus(queryClient.getQueryCache().getAll(), online);
  const state = useSyncExternalStore(subscribe, () => read().state);
  const lastSyncedAt = useSyncExternalStore(subscribe, () => read().lastSyncedAt);
  return { state, lastSyncedAt };
}
