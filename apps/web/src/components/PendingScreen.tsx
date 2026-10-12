/** A centred spinner for while a screen waits for its data. */
export function PendingScreen() {
  return (
    <div className="flex flex-1 items-center justify-center" role="status">
      <span className="size-8 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
