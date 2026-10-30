import { api } from '@quiz/client';

const KEPT = 'quiz:pushKept';

/**
 * Once a day per device, for an account with notifications allowed: this device's subscription posted to the server
 * again. It keeps it as it is (no greeting), or takes it back should it have dropped it; a device whose subscription
 * changed without the worker hearing of it (public/sw.js → pushsubscriptionchange) is found again too.
 */
export async function keepPushUp() {
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  const today = new Date().toDateString();
  try {
    if (localStorage.getItem(KEPT) === today) return;
  } catch {
    return;
  }
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!subscription) return;
  await api.pushSubscribe(subscription.toJSON());
  try {
    localStorage.setItem(KEPT, today);
  } catch {
    /* tried today regardless */
  }
}
