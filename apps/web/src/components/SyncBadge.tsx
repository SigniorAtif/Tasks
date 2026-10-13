import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '@tasks/core';
import { useCallback, useSyncExternalStore } from 'react';
import { meQuery } from '../lib/queries.ts';
import { syncBadgeText, syncStatus } from '../lib/sync-status.ts';
import { useOnline } from '../lib/use-online.ts';

/**
 * A small pill, "offline · last synced 2:02 PM", shown while the screen is
 * drawn from the copy saved on the device instead of a fresh answer (D-046).
 * Nothing at all while online and up to date. The rules are in
 * src/lib/sync-status.ts; this only watches the cache and draws.
 */
export function SyncBadge() {
  const queryClient = useQueryClient();
  const online = useOnline();

  // Re-read the cache whenever any query in it changes (a fetch starts, works
  // or fails). The snapshot is the badge's text, a plain string, so React only
  // re-renders when the text itself changes.
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const text = useSyncExternalStore(subscribe, () =>
    syncBadgeText(
      syncStatus(queryClient.getQueryCache().getAll(), online),
      Date.now(),
      queryClient.getQueryData<Me>(meQuery.queryKey)?.profile.tzid,
    ),
  );

  // The live region stays in the page (and not display: none) even when empty,
  // so screen readers reliably announce the text when it appears.
  return (
    <div role="status">
      {text !== null && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
          {text}
        </span>
      )}
    </div>
  );
}
