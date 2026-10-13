import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOnline = () => onlineManager.isOnline();

/**
 * Whether the browser says it has a network, as TanStack Query's `onlineManager`
 * sees it (the window's `online`/`offline` events), re-rendering when it changes.
 * It starts as `true` and can be wrong on Wi-Fi that needs a login page, so
 * treat `false` as "certainly offline" and `true` as "probably online".
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline);
}
