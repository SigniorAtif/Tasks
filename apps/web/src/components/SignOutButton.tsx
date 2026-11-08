import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../lib/auth-client.ts';
import { signOutWarning } from '../lib/occurrence-queue.ts';
import { forgetCachedData } from '../lib/persist.ts';
import { useQueuedChanges } from '../lib/use-queued-changes.ts';

const BUTTON =
  'w-full rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60';
const QUIET = `${BUTTON} text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800`;

/**
 * Ends the session on the server, forgets the cache (in memory and the copy
 * saved on the device), and goes to the login screen. With changes still
 * queued, it first says they'll be lost and asks again. Offline it asks too:
 * the button never turns off, though signing out needs the server, and says
 * so if it can't reach it.
 */
export function SignOutButton() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Why the last try failed: no signal, or the server said no.
  const [failed, setFailed] = useState<'offline' | 'refused' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const warning = signOutWarning(useQueuedChanges().length);

  async function signOut() {
    setBusy(true);
    setFailed(null);
    try {
      // Deletes the session on the server and clears the cookie.
      const { error } = await authClient.signOut();
      if (error) throw error;
    } catch {
      // Still signed in on the server: say so rather than pretend. Offline,
      // forgetting only this phone's copy would leave the session open for
      // whoever brings the phone back online, so nothing is forgotten.
      setFailed(navigator.onLine ? 'refused' : 'offline');
      setBusy(false);
      return;
    }
    // Forget everything cached for this user, on the device too, so nothing of
    // theirs is left for whoever uses the phone next. Then show the login screen.
    await forgetCachedData(queryClient);
    await router.navigate({ to: '/login', replace: true });
  }

  return (
    <div>
      {confirming && warning !== null ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
            {warning}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={QUIET}>
              Stay signed in
            </button>
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className={`${BUTTON} bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400`}
            >
              {busy ? 'Signing out…' : 'Sign out anyway'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (warning === null ? signOut() : setConfirming(true))}
          disabled={busy}
          className={QUIET}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      )}
      {failed !== null && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {failed === 'offline'
            ? "You're offline. Signing out needs the server, so nothing was deleted."
            : "Couldn't sign out. Try again."}
        </p>
      )}
    </div>
  );
}
