// The building blocks every form draws with: a labelled field with its hint
// and error, the colour swatches, the banner for a failed save and the Save
// row. They only draw; the forms (series/SeriesForm.tsx, groups/GroupForm.tsx)
// own the values.
//
// Accessibility, the same way everywhere: every input has a <label>; its hint
// and its error are linked with `aria-describedby`, so a screen reader reads
// them when the input gets the focus; an input with an error has
// `aria-invalid`. A warning that arrives while the user types (what a last day
// would hide) sits in a polite live region, so it's read out when it appears.

import { Link } from '@tanstack/react-router';
import { COLOR_TOKENS, type ColorToken, type ISODate } from '@tasks/core';
import type { ReactNode, Ref } from 'react';
import { dateLabel } from '../calendar/model/format.ts';
import { groupColor } from '../calendar/model/palette.ts';
import type { ErrorText } from '../lib/api.ts';
import { BACK, type BackTo } from './ScreenFrame.tsx';

/** The look of every text, date, time, number and select input. 16px text: iOS zooms in on less. */
export const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 disabled:opacity-60 aria-invalid:border-red-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:aria-invalid:border-red-400';

const hintId = (id: string) => `${id}-hint`;
const errorId = (id: string) => `${id}-error`;
const warningId = (id: string) => `${id}-warning`;

/** What can be said under an input. `warning: ''` keeps its live region, empty, for one to come. */
interface Notes {
  hint?: string | undefined;
  error?: string | undefined;
  warning?: string | undefined;
}

/** The ARIA attributes that tie an input to its notes. Spread onto the input. */
export function describedBy(id: string, { hint, error, warning }: Notes) {
  const ids = [hint && hintId(id), warning && warningId(id), error && errorId(id)]
    .filter(Boolean)
    .join(' ');
  return {
    'aria-describedby': ids === '' ? undefined : ids,
    'aria-invalid': error === undefined ? undefined : true,
  };
}

/** A field's hint, warning and error lines, under the input. */
export function FieldNotes({ id, hint, error, warning }: Notes & { id: string }) {
  return (
    <>
      {hint !== undefined && (
        <p id={hintId(id)} className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {warning !== undefined && (
        <p
          id={warningId(id)}
          aria-live="polite"
          className="mt-1 text-sm text-amber-800 empty:hidden dark:text-amber-300"
        >
          {warning}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId(id)} className="mt-1 text-sm font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </>
  );
}

/** A label above one input, with its notes below. */
export function Field({
  id,
  label,
  hint,
  error,
  warning,
  children,
}: Notes & { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      <FieldNotes id={id} hint={hint} error={error} warning={warning} />
    </div>
  );
}

/** "violet" → "Violet": the name a screen reader says for a swatch. */
const colorName = (token: ColorToken) => token.charAt(0).toUpperCase() + token.slice(1);

/**
 * The ten group colours (B11) as round swatches. Underneath they're ordinary
 * radio buttons, hidden but still focusable, so arrow keys move between them
 * and each one has a name for screen readers.
 */
export function ColorSwatches({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  checkedRef,
}: {
  id: string;
  label: string;
  value: ColorToken;
  onChange: (token: ColorToken) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** The selected radio, so the form can move the focus here. */
  checkedRef?: Ref<HTMLInputElement>;
}) {
  return (
    <fieldset {...describedBy(id, { error })}>
      <legend className="mb-1 block text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {COLOR_TOKENS.map((token) => (
          <label key={token} className="relative cursor-pointer">
            <input
              ref={token === value ? checkedRef : undefined}
              type="radio"
              name={id}
              value={token}
              checked={token === value}
              disabled={disabled}
              onChange={() => onChange(token)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              // The calendar's own palette variables (src/index.css), so a swatch
              // is exactly the colour the group's blocks get, in either theme.
              style={{ backgroundColor: groupColor(token) }}
              className={`block size-9 rounded-full ring-offset-2 ring-offset-white peer-checked:ring-2 peer-checked:ring-slate-900 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-indigo-600 dark:ring-offset-slate-950 dark:peer-checked:ring-white`}
            />
            <span className="sr-only">{colorName(token)}</span>
          </label>
        ))}
      </div>
      <FieldNotes id={id} error={error} />
    </fieldset>
  );
}

const alertBox =
  'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200';

/**
 * The alert above a form: why the save failed, or what the server refused that
 * belongs to no field. Empty, it takes no space. It's focusable, so a form can
 * move the focus here and a screen reader reads it out.
 */
export function FormBanner({
  ref,
  failure,
  other,
}: {
  ref: Ref<HTMLDivElement>;
  failure: ErrorText | null;
  other: readonly string[];
}) {
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="outline-none empty:hidden">
      {failure !== null && (
        <div className={alertBox}>
          <p className="font-semibold">{failure.title}</p>
          <p className="mt-1">{failure.message}</p>
          {failure.small !== undefined && (
            <p className="mt-1 font-mono text-xs opacity-75">{failure.small}</p>
          )}
        </div>
      )}
      {other.length > 0 && (
        <div className={alertBox}>
          <p className="font-semibold">The server didn't accept this:</p>
          <ul className="mt-1 list-disc pl-5">
            {other.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The id of the offline note, so a disabled button can point at it. */
export const OFFLINE_NOTE_ID = 'form-offline';

/**
 * Save and Cancel. Writes are online-only (D-048), so offline both Save and
 * the note above it say so, instead of a tap that fails.
 */
export function SaveRow({
  saving,
  disabled,
  offline,
  cancelTo,
}: {
  saving: boolean;
  disabled: boolean;
  offline: boolean;
  /** Where Cancel goes: the screen this form was opened from. */
  cancelTo: BackTo;
}) {
  return (
    <div className="flex flex-col gap-2">
      {offline && (
        <p id={OFFLINE_NOTE_ID} className="text-sm text-amber-800 dark:text-amber-300">
          You're offline. Changes need a connection.
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={disabled}
          aria-describedby={offline ? OFFLINE_NOTE_ID : undefined}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <Link
          to={BACK[cancelTo].to}
          className="rounded-lg px-4 py-3 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

/** What Archive says it does, per kind of row (CONTEXT.md: a last day ends things). */
const ARCHIVE_EFFECT = {
  group: 'Every class in it ends today',
  class: 'It ends today',
};

/**
 * Archive, below the Save row. One tap saves the form with `day` (today) as the
 * last day, so the other edits go with it; `hiddenNote` says beforehand what
 * that would hide. Nothing is erased: the weeks up to today stay on the calendar,
 * and a later last day brings back what it hid.
 */
export function ArchiveSection({
  what,
  day,
  hiddenNote,
  onArchive,
  archiving,
  disabled,
  offline,
}: {
  what: keyof typeof ARCHIVE_EFFECT;
  day: ISODate;
  hiddenNote: string | undefined;
  onArchive: () => void;
  archiving: boolean;
  disabled: boolean;
  offline: boolean;
}) {
  const noteId = 'archive-note';
  return (
    <section
      aria-label={`Archive this ${what}`}
      className="mt-2 border-t border-slate-200 pt-5 dark:border-slate-800"
    >
      <button
        type="button"
        onClick={onArchive}
        disabled={disabled}
        aria-describedby={offline ? `${noteId} ${OFFLINE_NOTE_ID}` : noteId}
        className="w-full rounded-lg px-4 py-2.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
      >
        {archiving ? 'Archiving…' : `Archive this ${what}`}
      </button>
      <div id={noteId} className="mt-2 text-sm">
        <p className="text-slate-600 dark:text-slate-400">
          {ARCHIVE_EFFECT[what]}, {dateLabel(day)}. Everything up to then stays on the calendar.
        </p>
        {hiddenNote !== undefined && (
          <p className="mt-1 text-amber-800 dark:text-amber-300">{hiddenNote}</p>
        )}
      </div>
    </section>
  );
}
