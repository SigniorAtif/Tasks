import type { Me } from '@tasks/core';
import { useId } from 'react';
import { Avatar } from './Avatar.tsx';
import { DeployedCommit } from './DeployedCommit.tsx';
import { SignOutButton } from './SignOutButton.tsx';

/**
 * The user's avatar in the title bar. Tapping it opens a small panel: who is
 * signed in, Sign out, and the deployed commit.
 *
 * The panel is a native HTML popover (`popover` + `popoverTarget`): the
 * browser opens and closes it, closes it on Escape or a tap outside, and
 * draws it above everything else, with no JavaScript of ours.
 */
export function AccountMenu({ user }: { user: Me['user'] }) {
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={panelId}
        aria-label={`Account: ${user.name}`}
        className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <Avatar name={user.name} email={user.email} image={user.image} className="size-8 text-sm" />
      </button>
      <div
        id={panelId}
        popover="auto"
        className="account-menu w-72 rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center gap-3">
          <Avatar name={user.name} email={user.email} image={user.image} className="size-10" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.name}</p>
            <p className="truncate text-sm text-slate-600 dark:text-slate-400">{user.email}</p>
          </div>
        </div>
        <div className="mt-4">
          <SignOutButton />
        </div>
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          <DeployedCommit />
        </div>
      </div>
    </>
  );
}
