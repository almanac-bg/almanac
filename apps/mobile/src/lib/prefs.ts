// The player's choices that live on the phone, not the account: the theme. Applied to the whole app — React Native's
// Appearance follows it, so the system's own sheets and alerts do too — and kept for the next start.
import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';
import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'almanac.theme';

export const usePrefs = create<{ theme: ThemeChoice }>(() => ({ theme: 'system' }));

const apply = (theme: ThemeChoice) => Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);

/** At the start, before the first screen: the theme chosen last time. */
export async function loadPrefs() {
  try {
    const saved = await SecureStore.getItemAsync(KEY);
    if (saved === 'light' || saved === 'dark') {
      usePrefs.setState({ theme: saved });
      apply(saved);
    }
  } catch {
    /* unreadable: the phone's own theme */
  }
}

export async function setTheme(theme: ThemeChoice) {
  usePrefs.setState({ theme });
  apply(theme);
  try {
    if (theme === 'system') await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, theme);
  } catch {
    /* kept for this run only */
  }
}
