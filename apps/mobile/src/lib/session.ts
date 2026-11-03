// The app's session: the token and the device mark the server gave it at sign-in (packages/shared → AppSession), kept in
// the phone's keychain (iOS) or keystore (Android), on this device only — a backup restored on another phone doesn't
// carry it. Read once at the start, then from memory: every /api request and the socket ask for it (src/lib/client.ts).
import type { AppSession } from '@almanac/shared';
import * as SecureStore from 'expo-secure-store';

const KEY = 'almanac.session';
const STORE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let current: AppSession | null = null;

export const session = () => current;

/** At the start: the session this device holds, if any. */
export async function loadSession(): Promise<AppSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, STORE);
    current = raw ? (JSON.parse(raw) as AppSession) : null;
  } catch {
    current = null; // unreadable (a keystore reset): signed out, which a sign-in mends
  }
  return current;
}

/**
 * A new session from a sign-in, sign-up, guest or new password. The device mark is kept across sessions of the same
 * account: a guest's way in has none, and keeps the one from before.
 */
export async function saveSession(next: AppSession) {
  current = { token: next.token, device: next.device ?? current?.device };
  await SecureStore.setItemAsync(KEY, JSON.stringify(current), STORE);
}

/** Signed out (or the server said the session is over): the token goes; the device mark stays for the next sign-in. */
export async function endSession() {
  if (!current) return;
  current = current.device ? { token: '', device: current.device } : null;
  if (current) await SecureStore.setItemAsync(KEY, JSON.stringify(current), STORE);
  else await SecureStore.deleteItemAsync(KEY, STORE);
}
