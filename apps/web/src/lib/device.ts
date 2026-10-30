import { api } from '@quiz/client';

const SHARE_PREFIX = 'quiz:daily-share:';

/**
 * Signing out (or deleting the account) on a shared device — a school's tablet, a family's phone — leaves nothing of
 * the player behind: this browser's push subscription (the next one to use it would get their friends' duels and
 * names), the day's share texts and the name used in a room. `server`: tell the server to drop the subscription too
 * (signing out; a deleted account's go with it).
 */
export async function forgetThisDevice({ server }: { server: boolean }) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      if (server) await api.pushUnsubscribe(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    }
  } catch {
    /* no service worker or push here */
  }
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(SHARE_PREFIX)) localStorage.removeItem(key);
    localStorage.removeItem('quiz:room-nickname');
    sessionStorage.removeItem('quiz:room-nickname');
  } catch {
    /* storage unavailable: nothing kept either */
  }
}

/** A day's share text is for that day (the lobby offers it again until midnight): older ones go when the app starts. */
export function dropOldShares(today: string) {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(SHARE_PREFIX) && key !== `${SHARE_PREFIX}${today}`) localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
