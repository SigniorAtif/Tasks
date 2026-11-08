// The sheet for one occurrence, opened by tapping its block: what it is, and
// what can be done to this one occurrence (Prof, Me or Not today, Restore,
// Change reason), plus a link to edit the whole series. Which buttons show is
// decided by `sheetActions` (model/sheet.ts).
//
// A button hands its change to the screen, which queues it (it works offline,
// #9), and the sheet closes at once: the calendar already shows the change.
//
// A native <dialog> opened with showModal(): the browser keeps focus inside it,
// Escape closes it, and the calendar behind can't be tapped. index.css makes it
// a bottom sheet on a phone and a dialog in the middle of the screen from 768 px.

import { Link } from '@tanstack/react-router';
import type { IanaZone, Occurrence, ScheduleGroup, UpdateOccurrence } from '@tasks/core';
import { useEffect, useId, useRef } from 'react';
import { longDayLabel, timeRangeLabel } from './model/format.ts';
import { type CancelButton, sheetActions } from './model/sheet.ts';

export function OccurrenceSheet({
  occurrence,
  waiting,
  group,
  zone,
  onClose,
  onChange,
}: {
  /** As the calendar shows it: with any queued change already applied. */
  occurrence: Occurrence;
  /** A change to it hasn't reached the server yet. */
  waiting: boolean;
  /** Its group. Until the groups have loaded, the sheet offers no actions. */
  group: Pick<ScheduleGroup, 'attendance'> | undefined;
  zone: IanaZone;
  /** The sheet closed, by a button, Escape, a tap outside it, or after an action. */
  onClose: () => void;
  /** An action was tapped: queue this change. The sheet then closes itself. */
  onChange: (change: UpdateOccurrence) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const sheet = dialog.current;
    if (sheet === null) return;
    if (!sheet.open) sheet.showModal();
    // A tap on the dimmed backdrop lands on the <dialog> itself; its content covers
    // the rest. (Escape is the keyboard's way out, built into the browser.)
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target === sheet) sheet.close();
    };
    sheet.addEventListener('click', closeOnBackdrop);
    return () => sheet.removeEventListener('click', closeOnBackdrop);
  }, []);

  const actions = group ? sheetActions(occurrence, group) : null;

  const send = (change: UpdateOccurrence) => {
    onChange(change);
    dialog.current?.close();
  };

  const time = timeRangeLabel(Date.parse(occurrence.start), Date.parse(occurrence.end), zone);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="occurrence-sheet bg-white text-slate-900 shadow-xl backdrop:bg-slate-950/40 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {occurrence.title}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {longDayLabel(occurrence.date)} · {time}
            </p>
            {occurrence.location && (
              <p className="text-sm text-slate-600 dark:text-slate-400">{occurrence.location}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
            className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600 dark:hover:bg-slate-800"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {actions?.state && (
          <p className="flex items-center gap-2 text-sm font-medium">{actions.state}</p>
        )}
        {waiting && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Waiting to sync: saved on this phone, not yet on the server.
          </p>
        )}

        {actions && actions.cancel.length > 0 && (
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            {actions.cancel.map((button) => (
              <ReasonButton key={button.word} button={button} onClick={() => send(button.change)} />
            ))}
          </div>
        )}

        {actions?.restore && (
          <button
            type="button"
            onClick={() => actions.restore && send(actions.restore)}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Restore
          </button>
        )}

        {actions && actions.changeReason.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">Change reason</p>
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              {actions.changeReason.map((button) => (
                <ReasonButton
                  key={button.word}
                  button={button}
                  onClick={() => send(button.change)}
                />
              ))}
            </div>
          </div>
        )}

        <Link
          to="/series/$seriesId"
          params={{ seriesId: occurrence.seriesId }}
          className="self-start rounded text-sm font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-indigo-300"
        >
          Edit all {occurrence.title}…
        </Link>
      </div>
    </dialog>
  );
}

/** Prof, Me or Not today: the word in large type, its small line under it. */
function ReasonButton({ button, onClick }: { button: CancelButton; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center rounded-xl px-3 py-2.5 ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:ring-slate-700 dark:hover:bg-slate-800"
    >
      <span className="text-base font-semibold">{button.word}</span>
      {button.line && (
        <span className="text-xs text-slate-600 dark:text-slate-400">{button.line}</span>
      )}
    </button>
  );
}
