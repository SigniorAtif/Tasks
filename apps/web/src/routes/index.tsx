import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { Avatar } from '../components/Avatar.tsx';
import { Logo } from '../components/Logo.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { authClient } from '../lib/auth-client.ts';
import { healthzQuery, meQuery } from '../lib/queries.ts';
import { formatInZone, serverNow } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';

// `/`, the home screen: who is signed in, the server's clock in their zone, and
// which commit is deployed (the v0.0 demo: merge a PR, see the new commit here).
export const Route = createFileRoute('/')({
  // Runs before anything draws. With no session, go to /login straight away,
  // so the page never flashes. Any other failure (offline, server error) falls
  // through to the route's error screen (src/components/ErrorScreen.tsx).
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (isUnauthenticated(error)) throw redirect({ to: '/login' });
      throw error;
    }
  },
  component: MeScreen,
});

function MeScreen() {
  // Already in the cache (beforeLoad put it there), so this never waits.
  const me = useSuspenseQuery(meQuery);

  // The session ended while the screen was open (a refetch got a 401).
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  const { user, profile, serverTime } = me.data;
  return (
    <main className="flex flex-1 flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-lg font-semibold">Tasks</span>
        </div>
        <SignOutButton />
      </header>

      {me.isRefetchError && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Can't reach the server right now. Showing what it last said; the clock keeps ticking.
        </p>
      )}

      <section className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <Avatar name={user.name} email={user.email} image={user.image} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{user.name}</p>
          <p className="truncate text-slate-600 dark:text-slate-400">{user.email}</p>
        </div>
      </section>

      <ServerClock serverTime={serverTime} receivedAt={me.dataUpdatedAt} tzid={profile.tzid} />

      <DeployedCommit />
    </main>
  );
}

/** The server's clock, ticking every second, as a wall clock in the user's zone. */
function ServerClock({
  serverTime,
  receivedAt,
  tzid,
}: {
  serverTime: string;
  receivedAt: number;
  tzid: string;
}) {
  const now = useNow();
  const moment = serverNow(serverTime, receivedAt, now);
  const shown = moment === null ? null : formatInZone(moment, tzid);

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">
        Server time in your zone
      </h2>
      {shown === null ? (
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          The server sent a time this app can't read.
        </p>
      ) : (
        <>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">{shown.time}</p>
          <p className="mt-1 text-slate-700 dark:text-slate-300">{shown.date}</p>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {shown.zone} · {shown.offset}
          </p>
          {shown.zone !== tzid && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              This browser doesn't know the zone “{tzid}”, so the time is shown in UTC.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** The commit the server was built from, from the public /healthz. */
function DeployedCommit() {
  const health = useQuery(healthzQuery);

  let text: string;
  if (health.data !== undefined) {
    const sha = health.data.sha;
    // Git's usual 7-character short form; `dev` (run from source) stays as is.
    text = `${/^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : sha} · database ${health.data.dbOk ? 'ok' : 'down'}`;
  } else if (health.isError) {
    text = 'unavailable';
  } else {
    text = '…';
  }

  return (
    <footer className="mt-auto text-center text-xs text-slate-500 dark:text-slate-400">
      Deployed commit{' '}
      <span className="font-mono" title={health.data?.sha}>
        {text}
      </span>
    </footer>
  );
}

function SignOutButton() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      // Deletes the session on the server and clears the cookie.
      const { error } = await authClient.signOut();
      if (error) throw error;
    } catch {
      // Still signed in on the server: say so rather than pretend.
      setFailed(true);
      setBusy(false);
      return;
    }
    // Forget everything cached for this user, then show the login screen.
    queryClient.clear();
    await router.navigate({ to: '/login', replace: true });
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {failed && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          Couldn't sign out. Try again.
        </p>
      )}
    </div>
  );
}
