import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '@tasks/core';
import { meQuery } from '../lib/queries.ts';
import { todayFor } from '../lib/time.ts';
import { LoadingLine } from './LoadingLine.tsx';

/**
 * A centred spinner for while a screen waits for its data, with the day's
 * loading line under it. The day comes from the cached `me`; before anyone is
 * signed in there's no day to ask, so it only says "Loading…" to screen readers.
 */
export function PendingScreen() {
  const profile = useQueryClient().getQueryData<Me>(meQuery.queryKey)?.profile;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3" role="status">
      <span className="size-8 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400" />
      {profile ? (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          <LoadingLine day={todayFor(profile)} />
        </span>
      ) : (
        <span className="sr-only">Loading…</span>
      )}
    </div>
  );
}
