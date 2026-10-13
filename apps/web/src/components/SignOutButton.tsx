import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../lib/auth-client.ts';

/** Ends the session on the server, forgets the cache, and goes to the login screen. */
export function SignOutButton() {
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
    <div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
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
