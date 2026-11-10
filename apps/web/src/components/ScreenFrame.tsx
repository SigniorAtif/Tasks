import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SyncBadge } from './SyncBadge.tsx';

/** Where a screen's back link (and a form's Cancel) goes. */
export const BACK = {
  calendar: { to: '/', label: 'Calendar', long: 'Back to the calendar' },
  groups: { to: '/groups', label: 'Groups', long: 'Back to Groups' },
} as const;

export type BackTo = keyof typeof BACK;

const backLinkClass =
  'inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-400';

/**
 * The frame around the screens off the calendar (a class, the groups, a
 * group): a way back, the sync badge, a title, and an optional action beside it.
 */
export function ScreenFrame({
  title,
  back,
  action,
  children,
}: {
  title: string;
  back: BackTo;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <Link to={BACK[back].to} className={backLinkClass}>
            <span aria-hidden="true">←</span> {BACK[back].label}
          </Link>
          <SyncBadge />
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {action}
        </div>
      </header>
      {children}
    </main>
  );
}

/** A link to a row that isn't there: deleted, or a link from someone else. */
export function GoneScreen({ title, back }: { title: string; back: BackTo }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-slate-600 dark:text-slate-400">
        It may have been deleted, here or on another device.
      </p>
      <Link
        to={BACK[back].to}
        className="font-medium text-indigo-600 underline dark:text-indigo-400"
      >
        {BACK[back].long}
      </Link>
    </main>
  );
}
