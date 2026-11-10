import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '@tasks/core';
import { meQuery } from '../lib/queries.ts';
import { quip } from '../lib/quips.ts';
import { syncBadgeText } from '../lib/sync-status.ts';
import { todayFor } from '../lib/time.ts';
import { useSyncStatus } from '../lib/use-sync-status.ts';

/**
 * A small pill, "offline · last synced 2:02 PM", shown while the screen is
 * drawn from the copy saved on the device instead of a fresh answer (D-046),
 * or while changes wait for the server ("2 changes waiting"). Nothing at all
 * while online, up to date and with nothing waiting. The rules are in
 * src/lib/sync-status.ts; this only draws, and adds the day's quip while out
 * of touch ("offline · last synced 2:02 PM · working from memory"). Changes
 * that are merely on their way get no joke: they're gone in a second.
 */
export function SyncBadge() {
  const queryClient = useQueryClient();
  const status = useSyncStatus();
  // The user's zone and day, from the cached `me`. It changes only when `me`
  // is fetched, which also changes `status`, so reading it here stays current.
  const profile = queryClient.getQueryData<Me>(meQuery.queryKey)?.profile;
  const now = Date.now();
  const text = syncBadgeText(status, now, profile?.tzid);
  const line = status.state !== 'synced' && profile ? quip('badge', todayFor(profile, now)) : null;

  // The live region stays in the page (and not display: none) even when empty,
  // so screen readers reliably announce the text when it appears.
  return (
    <div role="status">
      {text !== null && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
          {text}
          {line !== null && ` · ${line}`}
        </span>
      )}
    </div>
  );
}
