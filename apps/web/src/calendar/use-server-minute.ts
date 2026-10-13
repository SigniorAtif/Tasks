import type { Instant } from '@tasks/core';
import { useEffect, useState } from 'react';
import { serverNow } from '../lib/time.ts';

/** Milliseconds from `epochMs` until the next whole minute starts (never 0: a full minute on the dot). */
export function msUntilNextMinute(epochMs: number): number {
  return 60_000 - (((epochMs % 60_000) + 60_000) % 60_000);
}

/**
 * The server's clock (estimated from the last `/api/v1/me`, see lib/time.ts),
 * re-rendering once a minute, just after the server's minute changes: enough
 * for a now line, at a sixtieth of the cost of a once-a-second timer.
 *
 * Phones pause timers in background tabs, so when the app comes back to the
 * front (`visibilitychange`) it re-reads the clock at once instead of showing
 * the time it went to sleep at.
 */
export function useServerMinute(serverTime: Instant, receivedAt: number): number {
  const [deviceNow, setDeviceNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = Date.now();
      setDeviceNow(now);
      const server = serverNow(serverTime, receivedAt, now) ?? now;
      // A few ms late, so the new minute has surely started when we look.
      timer = setTimeout(tick, msUntilNextMinute(server) + 20);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [serverTime, receivedAt]);

  return serverNow(serverTime, receivedAt, deviceNow) ?? deviceNow;
}
