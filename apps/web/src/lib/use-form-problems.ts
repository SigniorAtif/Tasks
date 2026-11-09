// What a form shows when Save goes wrong, and where the focus goes: the series
// form and the group form share it. The problems themselves come from
// form-problems.ts; this hook keeps them on screen.

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { NO_PROBLEMS, type Problems } from './form-problems.ts';

/**
 * A form's problems (one message per field, plus any for no field), the
 * failure of its last save, and the focus moves that go with them.
 * `firstProblem` names the field to focus: the first one on screen.
 */
export function useFormProblems<Field extends string>(
  firstProblem: (problems: Problems<Field>) => Field | undefined,
) {
  const [problems, setProblems] = useState<Problems<Field>>(NO_PROBLEMS);
  const [failure, setFailure] = useState<unknown>(null);
  const inputs = useRef<Partial<Record<Field, HTMLElement | null>>>({});
  /** The alert above the form (`FormBanner`): focused for a failure or a problem with no field. */
  const banner = useRef<HTMLDivElement>(null);

  return {
    problems,
    failure,
    banner,

    /** Remembers a field's element, so a problem can move the focus to it. Pass as `ref`. */
    register: (field: Field) => (element: HTMLElement | null) => {
      inputs.current[field] = element;
    },

    /** A new try: nothing to show until it says otherwise. */
    reset() {
      setProblems(NO_PROBLEMS);
      setFailure(null);
    },

    /** Editing a field takes its error away: the user is fixing it. Save checks again. */
    clearProblem(field: Field) {
      setProblems((p) => {
        if (p.fields[field] === undefined) return p;
        const fields = { ...p.fields };
        delete fields[field];
        return { ...p, fields };
      });
    },

    /** Shows the problems and moves the focus to the first one. */
    showProblems(found: Problems<Field>) {
      // Draw the messages first, so the input that gets the focus already
      // points at its error and a screen reader reads it out.
      flushSync(() => setProblems(found));
      const field = firstProblem(found);
      if (field === undefined) banner.current?.focus();
      else inputs.current[field]?.focus();
    },

    /** Shows why the save failed, in the banner, and moves the focus there. */
    showFailure(error: unknown) {
      flushSync(() => setFailure(error));
      banner.current?.focus();
    },
  };
}
