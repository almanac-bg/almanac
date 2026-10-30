import { useSyncExternalStore } from 'react';

/**
 * The match's one-key shortcuts on this device: 1–4 for the answers (and a round's category), Q, W, E for the козове,
 * P for a pause in Соло, digits for a number. On unless switched off in Settings → „Достъпност“: someone who dictates
 * or speaks to their device sends words as keys, and a stray „e“ was a bet of 500 points (WCAG 2.1.4). Enter, ⌫ and
 * the arrows aren't single characters and stay on.
 */
const KEY = 'quiz:matchKeys';
const listeners = new Set<() => void>();

export function matchKeysOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setMatchKeys(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    /* storage unavailable: on for this visit */
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the keys are on, kept up as the setting changes. */
export const useMatchKeysOn = () => useSyncExternalStore(subscribe, matchKeysOn, () => true);
