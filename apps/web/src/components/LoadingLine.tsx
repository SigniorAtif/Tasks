import type { ISODate } from '@tasks/core';
import { useState } from 'react';
import { loadingQuip } from '../lib/quips.ts';

/**
 * The words of a loading notice: the day's loading line, or on a rare roll a
 * rarer one. Screen readers hear a plain "Loading…" instead: a joke is no way
 * to learn that the screen is waiting. `day` is the user's day (`todayFor`).
 */
export function LoadingLine({ day }: { day: ISODate }) {
  // Rolled once each time a notice appears, so the line doesn't change while it waits.
  const [roll] = useState(Math.random);
  return (
    <>
      <span aria-hidden="true">{loadingQuip(day, roll)}</span>
      <span className="sr-only">Loading…</span>
    </>
  );
}
