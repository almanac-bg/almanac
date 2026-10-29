import { useEffect, useSyncExternalStore } from 'react';

/** The colour theme a device asked for: the dark one (the game's own), the light one, or as the device is set. */
export type ThemeChoice = 'dark' | 'light' | 'system';

const KEY = 'quiz:theme';
const COLORS = { dark: '#07060d', light: '#f4f3f9' } as const;
const lightQuery = () => window.matchMedia('(prefers-color-scheme: light)');
const listeners = new Set<() => void>();
/** A screen that wants a theme of its own while it's on (the room's big screen: light on a projector). */
let forced: 'dark' | 'light' | null = null;

export function themeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'system' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

/** The theme on screen now. */
const resolved = (): 'dark' | 'light' => {
  if (forced) return forced;
  const choice = themeChoice();
  return choice === 'light' || (choice === 'system' && lightQuery().matches) ? 'light' : 'dark';
};

/** Puts the theme on the page (public/theme.js did it once before the first paint). */
export function applyTheme() {
  const theme = resolved();
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'dark') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not kept (no storage): it still applies until the page is closed.
  }
  applyTheme();
  for (const fn of listeners) fn();
}

/** Follows the device's own setting while the choice is „Като системата“. */
export function watchSystemTheme() {
  const query = lightQuery();
  const change = () => {
    if (themeChoice() === 'system') applyTheme();
  };
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    themeChoice,
    () => 'dark',
  );
}

/** While the calling screen is on, the page is in `theme`, whatever the device's choice. */
export function useForcedTheme(theme: 'dark' | 'light') {
  useEffect(() => {
    forced = theme;
    applyTheme();
    return () => {
      forced = null;
      applyTheme();
    };
  }, [theme]);
}
