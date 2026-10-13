// Small building blocks for the series form: a labelled field with its hint and
// error, the day toggles and the colour swatches. They only draw; the form
// (SeriesForm.tsx) owns the values.
//
// Accessibility, the same way everywhere: every input has a <label>; its hint
// and its error are linked with `aria-describedby`, so a screen reader reads
// them when the input gets the focus; an input with an error has
// `aria-invalid`.

import { COLOR_TOKENS, type ColorToken, type Weekday } from '@tasks/core';
import type { ReactNode, Ref } from 'react';
import { groupColor } from '../calendar/model/palette.ts';
import { WEEKDAYS } from './form-values.ts';

/** The look of every text, date, time, number and select input. 16px text: iOS zooms in on less. */
export const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 disabled:opacity-60 aria-invalid:border-red-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:aria-invalid:border-red-400';

const hintId = (id: string) => `${id}-hint`;
const errorId = (id: string) => `${id}-error`;

/** The ARIA attributes that tie an input to its hint and error. Spread onto the input. */
export function describedBy(
  id: string,
  { hint, error }: { hint?: string | undefined; error?: string | undefined },
) {
  const ids = [hint && hintId(id), error && errorId(id)].filter(Boolean).join(' ');
  return {
    'aria-describedby': ids === '' ? undefined : ids,
    'aria-invalid': error === undefined ? undefined : true,
  };
}

/** A field's hint and error lines, under the input. */
export function FieldNotes({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  return (
    <>
      {hint !== undefined && (
        <p id={hintId(id)} className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {hint}
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

/** A label above one input, with its hint and error below. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      <FieldNotes id={id} hint={hint} error={error} />
    </div>
  );
}

/** Mon to Sun as toggle buttons (`aria-pressed`), Monday first (B11). */
export function DayToggles({
  id,
  label,
  days,
  onChange,
  error,
  disabled,
  firstRef,
}: {
  id: string;
  label: string;
  days: readonly Weekday[];
  onChange: (days: Weekday[]) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** The Monday button, so the form can move the focus here when no day is picked. */
  firstRef?: Ref<HTMLButtonElement>;
}) {
  const toggle = (day: Weekday) =>
    onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
  return (
    <fieldset {...describedBy(id, { error })}>
      <legend className="mb-1 block text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map(({ day, short, long }, index) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              aria-pressed={on}
              aria-label={long}
              disabled={disabled}
              onClick={() => toggle(day)}
              className={`rounded-lg py-2.5 text-sm font-medium ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 ${
                on
                  ? 'bg-indigo-600 text-white ring-indigo-600 dark:bg-indigo-500 dark:ring-indigo-500'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              {short}
            </button>
          );
        })}
      </div>
      <FieldNotes id={id} error={error} />
    </fieldset>
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
