import { useCallback, useSyncExternalStore } from 'react';

/** Whether a media query matches, kept live — for things sized in JS (e.g. an avatar's pixel size per breakpoint). */
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
