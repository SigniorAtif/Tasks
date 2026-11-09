// The series form's own control: the day toggles. The rest of the form's
// building blocks are shared with the group form (components/form-controls.tsx).

import type { Weekday } from '@tasks/core';
import type { Ref } from 'react';
import { describedBy, FieldNotes } from '../components/form-controls.tsx';
import { WEEKDAYS } from './form-values.ts';

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
