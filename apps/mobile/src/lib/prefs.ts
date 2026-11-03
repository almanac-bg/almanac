// The player's choices that live on the phone, not the account: the theme (applied to the whole app — React Native's
// Appearance follows it, so the system's own sheets and alerts do too) and the sounds, kept for the next start.
import * as SecureStore from 'expo-secure-store';
import { Appearance } from 'react-native';
import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'almanac.theme';
const SOUND_KEY = 'almanac.sound';

export const usePrefs = create<{ theme: ThemeChoice; sound: boolean }>(() => ({ theme: 'system', sound: true }));

const apply = (theme: ThemeChoice) => Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);

/** At the start, before the first screen: the theme chosen last time, and whether the sounds are off. */
export async function loadPrefs() {
  try {
    if ((await SecureStore.getItemAsync(SOUND_KEY)) === 'off') usePrefs.setState({ sound: false });
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

/** The game's sounds on or off on this phone (its own silent switch silences them either way). */
export async function setSound(on: boolean) {
  usePrefs.setState({ sound: on });
  try {
    if (on) await SecureStore.deleteItemAsync(SOUND_KEY);
    else await SecureStore.setItemAsync(SOUND_KEY, 'off');
  } catch {
    /* kept for this run only */
  }
}
