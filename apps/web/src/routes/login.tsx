import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { GoogleIcon } from '../components/GoogleIcon.tsx';
import { Logo } from '../components/Logo.tsx';
import { authClient } from '../lib/auth-client.ts';
import {
  callbackErrorMessage,
  type LoginMessage,
  signInErrorMessage,
} from '../lib/login-messages.ts';
import { meQuery } from '../lib/queries.ts';

/** The URL's query string, checked: `/login?error=not_invited`. */
interface LoginSearch {
  error?: string;
}

export const Route = createFileRoute('/login')({
  // Better Auth sends people back here with `?error=<code>` when Google sign-in
  // fails. Anything else in the query string is dropped.
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === 'string' && search.error !== '' ? search.error : undefined,
  }),
  // Already signed in? Skip the login screen. Any failure (no session,
  // offline) means "show the login screen", so it isn't retried.
  beforeLoad: async ({ context }) => {
    const signedIn = await context.queryClient.ensureQueryData({ ...meQuery, retry: false }).then(
      () => true,
      () => false,
    );
    if (signedIn) throw redirect({ to: '/' });
  },
  component: LoginScreen,
});

function LoginScreen() {
  const { error } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LoginMessage | null>(null);

  // A failed click replaces the message Google's redirect brought.
  const message = failure ?? (error === undefined ? null : callbackErrorMessage(error));

  async function continueWithGoogle() {
    setBusy(true);
    setFailure(null);
    try {
      // Asks our API for Google's sign-in address, then the client navigates
      // there. Google sends the user back to /api/auth/callback/google, which
      // sets the session cookie and redirects to `callbackURL`.
      const { error: signInError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/',
        errorCallbackURL: '/login',
      });
      if (signInError) {
        setFailure(signInErrorMessage(signInError));
        setBusy(false);
      }
      // On success the page is already leaving for Google; stay "busy".
    } catch {
      // fetch itself threw: no answer at all.
      setFailure(signInErrorMessage(null));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <Logo className="size-20 drop-shadow-sm" />
        <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Your week and your to-dos, in one place.
        </p>
      </div>

      <div className="flex w-full flex-col gap-4">
        {message !== null && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            <p>{message.text}</p>
            {message.code !== undefined && (
              <p className="mt-1 font-mono text-xs opacity-75">Error code: {message.code}</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <GoogleIcon className="size-5" />
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>

        <p className="text-xs text-slate-500">Sign-in is invite-only for now.</p>
      </div>
    </main>
  );
}
