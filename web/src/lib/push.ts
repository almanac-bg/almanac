// Notifications: the evening reminder and word from friends (a link accepted, a call to a duel). The browser asks the player first; the
// service worker (/sw.js) shows them.

import { pushKey } from "../state.ts";
import { api } from "./api.ts";
import { reportProblem } from "./errors.ts";

/** Whether this browser can take notifications from the game. */
export const pushable = () =>
  !!pushKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** An iPhone or iPad in a browser tab: notifications come only once the game is added to the home screen. */
export const needsHomeScreen = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !("PushManager" in window) &&
  !matchMedia("(display-mode: standalone)").matches;

async function registration(): Promise<ServiceWorkerRegistration> {
  return (
    (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" })
  );
}

/** Whether this browser has notifications on for the game. */
export async function pushOn(): Promise<boolean> {
  if (!pushable()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return !!(await reg?.pushManager.getSubscription());
}

/** Turns notifications on (asking the player), or says why not. */
export async function turnOn(): Promise<string | null> {
  if ((await Notification.requestPermission()) !== "granted") {
    return "Браузърът не позволи известия. Може да ги разрешиш от настройките му за сайта.";
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(pushKey) });
  } catch (err) {
    // The browser's push service said no. Brave keeps it off until it's switched on; the others have it on.
    reportProblem(`push subscribe: ${(err as Error).name}: ${(err as Error).message}`);
    return /Brave/.test(navigator.userAgent) || "brave" in navigator
      ? "Brave изключва известията по подразбиране. Включи ги от Настройки → Поверителност и сигурност → „Use Google services for push messaging“ и опитай пак."
      : "Браузърът не успя да включи известията. Опитай пак или в друг браузър (Chrome, Firefox, Safari).";
  }
  await api("POST", "/api/push", sub.toJSON());
  return null;
}

export async function turnOff(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("DELETE", "/api/push", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

function key(base64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
