import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches right now, such as `(min-width: 768px)`,
 * re-rendering when that changes (a window resized, a tablet rotated).
 *
 * `useSyncExternalStore` is React's hook for reading a value that lives
 * outside React: it subscribes to the browser's change event and asks for
 * the current value whenever it fires.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
