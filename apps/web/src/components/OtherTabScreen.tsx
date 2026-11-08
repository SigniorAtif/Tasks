import { useState } from 'react';
import { Logo } from './Logo.tsx';

/**
 * What a second tab shows while another tab runs the app (lib/one-tab.ts):
 * the app runs in one tab at a time, so changes saved on the device for
 * sending later live in one place. "Use here" moves it to this tab, and the
 * other one closes, or, where the browser won't allow that, shows this screen.
 *
 * Drawn outside the router, the same narrow column as the login screen.
 */
export function OtherTabScreen({ onUseHere }: { onUseHere: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo className="size-20 drop-shadow-sm" />
          <h1 className="text-2xl font-semibold tracking-tight">Tasks is open in another tab</h1>
          <p className="text-slate-600 dark:text-slate-400">
            It runs in one tab at a time, so changes waiting to sync stay in one place. Use it here
            instead? The other tab steps aside.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onUseHere();
          }}
          className="w-full rounded-full bg-indigo-600 px-5 py-3 font-medium text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {busy ? 'Moving here…' : 'Use here'}
        </button>
      </main>
    </div>
  );
}
