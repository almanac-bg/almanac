import { api, setState, useStore } from '@almanac/client';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { openPath } from './links';

/** This phone's token from Apple's or Google's service, as last given to the server: to take it back here. */
const TOKEN_KEY = 'almanac.push-token';

/**
 * Whether this phone's token is from Apple's sandbox service (the server sends there then): only for an app signed with
 * a development provisioning profile — Xcode, over a cable. Expo's builds for testing, development builds too, are
 * signed ad hoc and get the real service's tokens, as TestFlight's and the App Store's do (those keep no provisioning
 * profile in the app: null). So the provisioning profile says, not __DEV__: that is how the JavaScript runs, not how
 * the app was signed.
 */
async function apnsSandbox(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return (await Application.getIosPushNotificationServiceEnvironmentAsync()) === 'development';
}

/** The phone's token given to the server, and kept here; the profile that comes back says what's on. */
async function register(token: string) {
  const { user } = await api.registerPushDevice(token, await apnsSandbox());
  setState({ me: user });
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

/** Whether this phone gets pushes now: allowed, and its token with the server. */
export async function pushOnHere(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted && !!(await SecureStore.getItemAsync(TOKEN_KEY));
}

/** Whether the phone's own settings say no (then only they can say yes again). */
export async function pushBlocked(): Promise<boolean> {
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  return !granted && !canAskAgain;
}

/** Pushes on for this phone: the phone asks (once), then its token goes to the server. False: the phone said no. */
export async function enablePush(): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return false;
  const { data } = await Notifications.getDevicePushTokenAsync();
  await register(String(data));
  return true;
}

/** Pushes off for this phone: its token taken back (the others the player has keep theirs). */
export async function disablePush() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) await api.forgetPushDevice(token);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** Where a push leads: its `url` — Google's in `data`, Apple's beside `aps`. */
function pushPath(response: Notifications.NotificationResponse): string | null {
  const { content, trigger } = response.notification.request;
  const data = content.data as { url?: unknown } | null;
  const raw = trigger as { payload?: { url?: unknown }; remoteMessage?: { data?: { url?: unknown } } } | null;
  const url = data?.url ?? raw?.payload?.url ?? raw?.remoteMessage?.data?.url;
  return typeof url === 'string' && url.startsWith('/') ? url : null;
}

/**
 * While someone is signed in: a push tapped opens where it leads (also the one that started the app), and a token the
 * phone renews goes to the server in place of the old one.
 */
export function usePush() {
  const signedIn = useStore((s) => !!s.me);
  // A push that comes while the app is open shows as a banner too (the server sends few, and only what matters).
  useEffect(
    () =>
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      }),
    [],
  );
  useEffect(() => {
    if (!signedIn) return;
    // The tap that opened the app, once: cleared, it doesn't open again on the next start.
    const opening = Notifications.getLastNotificationResponse();
    const first = opening && pushPath(opening);
    if (first) {
      Notifications.clearLastNotificationResponse();
      openPath(first);
    }
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      const path = pushPath(r);
      if (path) openPath(path);
    });
    const renewed = Notifications.addPushTokenListener(({ data }) => {
      void SecureStore.getItemAsync(TOKEN_KEY).then((had) => {
        if (!had || had === String(data)) return;
        void register(String(data))
          .then(() => api.forgetPushDevice(had))
          .catch(() => {});
      });
    });
    return () => {
      tapped.remove();
      renewed.remove();
    };
  }, [signedIn]);
}
