// Notifications: the evening reminder, word from friends (a link accepted, a call to a duel) and Роял's call, each kind
// on or off as the player chooses. The browser asks the player first; the service worker (/sw.js) shows them.

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

/** Registers the service worker as the game opens, so that a tap on „Включи“ finds it ready: on an iPhone the
 * browser asks about notifications only within a moment of the tap, and a worker still installing then costs it. */
export function preparePush(): void {
  if (pushable()) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  return reg.active ? reg : navigator.serviceWorker.ready;
}

/** Whether this browser has notifications on for the game. A subscription the browser has is told to the server again
 * (it keeps it once), so that one it never heard of, or heard of for another player here, is the one it sends to. */
export async function pushOn(): Promise<boolean> {
  if (!pushable()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) api("POST", "/api/push", sub.toJSON()).catch(() => {});
  return !!sub;
}

/** Turns notifications on (asking the player), or says why not. It subscribes straight from the player's tap, and the
 * browser asks for permission as it does: an iPhone allows the subscription only within a moment of a tap, so asking
 * first (Notification.requestPermission) and subscribing after the player answers is too late there. */
export async function turnOn(): Promise<string | null> {
  if (Notification.permission === "denied") return denied;
  const reg = await registration();
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(pushKey) });
  } catch (err) {
    if (Notification.permission !== "granted") return denied;
    // The browser's push service said no. Brave keeps it off until it's switched on; the others have it on.
    reportProblem(`push subscribe: ${(err as Error).name}: ${(err as Error).message}`);
    return /Brave/.test(navigator.userAgent) || "brave" in navigator
      ? "Brave изключва известията по подразбиране. Включи ги от Настройки → Поверителност и сигурност → „Use Google services for push messaging“ и опитай пак."
      : "Браузърът не успя да включи известията. Опитай пак или в друг браузър (Chrome, Firefox, Safari).";
  }
  try {
    await api("POST", "/api/push", sub.toJSON());
  } catch (err) {
    // Not kept by the server: not on here either, so that the switch says what's true.
    await sub.unsubscribe().catch(() => {});
    throw err;
  }
  return null;
}

const denied = "Браузърът не позволи известия. Може да ги разрешиш от настройките му за сайта.";

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

/** The kinds of notification a player chooses: the day's reminder, word from friends and of games, Роял's call. */
export type PushKind = "day" | "friends" | "royal";
export type PushPrefs = Record<PushKind, boolean>;

/** Which kinds of notification the player gets. */
export const pushPrefs = () => api<{ prefs: PushPrefs }>("GET", "/api/push/prefs").then((r) => r.prefs);

/** Turns one kind on or off; the kinds as they are now. */
export const setPushPref = (kind: PushKind, on: boolean) =>
  api<{ prefs: PushPrefs }>("PATCH", "/api/push/prefs", { kind, on }).then((r) => r.prefs);
