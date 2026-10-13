import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router';
import type { Occurrence } from '@tasks/core';
import { useCallback } from 'react';
import { CalendarScreen } from '../calendar/CalendarScreen.tsx';
import { AccountMenu } from '../components/AccountMenu.tsx';
import { Logo } from '../components/Logo.tsx';
import { SyncBadge } from '../components/SyncBadge.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { meQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';

// `/`, the home screen: this week's calendar, a button to add a class, the
// "offline · last synced" badge, and the account menu (sign out, deployed
// commit) behind the avatar. Tapping a class opens it in the series form.
export const Route = createFileRoute('/')({
  // The week view needs the whole window, not the phone-width column (__root.tsx).
  staticData: { wide: true },
  // No session → /login before anything draws; offline, the user saved on the
  // device counts (src/lib/require-session.ts).
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  component: HomeScreen,
});

function HomeScreen() {
  // Already in the cache (beforeLoad put it there), so this never waits.
  const me = useSuspenseQuery(meQuery);
  const navigate = useNavigate();
  // A class on the calendar → the form that edits its series ("DS on Fridays").
  // One series makes many occurrences; editing it changes all of them (v0.3b
  // adds "only this one").
  const openSeries = useCallback(
    (occurrence: Occurrence) =>
      navigate({ to: '/series/$seriesId', params: { seriesId: occurrence.seriesId } }),
    [navigate],
  );

  // The session ended while the screen was open (a refetch got a 401).
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <CalendarScreen
        onOpen={openSeries}
        leading={
          <span className="flex shrink-0 items-center gap-2">
            <Logo className="size-8" />
            <span className="hidden text-lg font-semibold md:inline">Tasks</span>
          </span>
        }
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            <SyncBadge />
            <Link
              to="/series/new"
              aria-label="Add a class"
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              <span aria-hidden="true" className="text-base leading-none">
                +
              </span>
              <span className="hidden sm:inline">Add class</span>
            </Link>
            <AccountMenu user={me.data.user} />
          </span>
        }
      />
    </main>
  );
}
