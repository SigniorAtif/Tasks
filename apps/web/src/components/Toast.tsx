import { useEffect, useEffectEvent } from 'react';

/** How long a toast stays: long enough to reach for Undo, short enough to forget. */
const TOAST_MS = 8_000;

export interface ToastMessage {
  text: string;
  /** One button, such as Undo. Tapping it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
}

/**
 * A short message at the bottom of the screen that goes away by itself after
 * eight seconds. A new message replaces the old one and starts the eight
 * seconds again. The live region is always in the page, empty when there's no
 * message, so screen readers announce each message as it appears.
 */
export function Toast({
  message,
  onDismiss,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
}) {
  // The latest `onDismiss`, without restarting the timer when the screen re-renders.
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {message !== null && (
        <div className="pointer-events-auto flex max-w-sm items-center gap-4 rounded-xl bg-slate-900 py-2 pr-2 pl-4 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          <span className="min-w-0 flex-1">{message.text}</span>
          {message.action && (
            <button
              type="button"
              onClick={() => {
                message.action?.onClick();
                onDismiss();
              }}
              className="shrink-0 rounded-lg px-3 py-1.5 font-semibold text-indigo-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-indigo-300 dark:text-indigo-700 dark:hover:bg-slate-900/10 dark:focus-visible:outline-indigo-700"
            >
              {message.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
