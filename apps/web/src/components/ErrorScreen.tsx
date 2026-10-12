import { type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import { describeError } from '../lib/api.ts';

/**
 * What a route shows when loading it failed: offline, a server error, a bug.
 * "Try again" re-runs the route's loading. The app keeps working around it.
 */
export function ErrorScreen({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { title, message, small } = describeError(error);
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
      role="alert"
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-slate-600 dark:text-slate-400">{message}</p>
      {small !== undefined && (
        <p className="font-mono text-xs text-slate-500 dark:text-slate-500">{small}</p>
      )}
      <button
        type="button"
        className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </button>
    </div>
  );
}
