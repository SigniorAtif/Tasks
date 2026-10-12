import { useEffect, useState } from 'react';

/** This device's `Date.now()`, updated every `intervalMs`, so a clock on screen ticks. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    // Stop ticking when the component leaves the screen.
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
