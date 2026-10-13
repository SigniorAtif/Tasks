import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SyncBadge } from '../components/SyncBadge.tsx';

const backLinkClass =
  'inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-400';

/** The frame around the add and edit screens: a way back, the sync badge, a title. */
export function SeriesScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <Link to="/" className={backLinkClass}>
            <span aria-hidden="true">←</span> Calendar
          </Link>
          <SyncBadge />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>
      {children}
    </main>
  );
}

/** `/series/<id>` for a class that isn't there: deleted, or a link from someone else. */
export function SeriesNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">This class doesn't exist any more</h1>
      <p className="text-slate-600 dark:text-slate-400">
        It may have been deleted, here or on another device.
      </p>
      <Link to="/" className="font-medium text-indigo-600 underline dark:text-indigo-400">
        Back to the calendar
      </Link>
    </main>
  );
}
