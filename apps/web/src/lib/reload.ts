/** Long enough for a navigation away to take the page with it, short enough that a reload still feels prompt. */
const LEAVING_MS = 1500;

/** Reloaded for this already, in the last 10 s (the stamp outlives the reload: it's this tab's). */
function reloadedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem('almanac:reloadedAt') ?? 0) < 10_000;
  } catch {
    return false; // storage unavailable: reload anyway
  }
}

function stamp() {
  try {
    sessionStorage.setItem('almanac:reloadedAt', String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway */
  }
}

/**
 * Code that was about to be shown didn't arrive. A tab opened before a deploy asks for files that are gone: one reload
 * gets the new version. Not while offline (that would only swap the app for the offline page), and not twice in a
 * row. Only for code being shown: a background fetch that fails (prefetchPages) mustn't reload the app under the
 * player, taking whatever they were typing with it.
 *
 * Says whether it will reload — after a moment: a download cut short because the page is being left (a link out, a
 * typed address) fails the same way, and a reload at once took that navigation over. A page being left is gone before
 * the moment is up, and nothing is noted. Meanwhile what waited for the code goes on waiting (holdForReload): a spinner,
 * not „Страницата не се зареди“ for the second before the reload.
 */
export function reloadForNewVersion(): boolean {
  if (!navigator.onLine || reloadedRecently()) return false;
  setTimeout(() => {
    if (reloadedRecently()) return;
    stamp();
    window.location.reload();
  }, LEAVING_MS);
  return true;
}

/**
 * „Опитай пак“, and the page's code failed again: the page itself loads anew, at once (the player asked). A new import
 * isn't always a new download: Chromium now and then keeps a file's failed download for the tab and hands it to every
 * later import without asking the server again (CI's traces, 4 November 2026), and only a new page asks. Says whether
 * it will reload; not while offline. Stamped, so the new page shows its error instead of reloading by itself: one
 * reload per press, never a loop.
 */
export function reloadAfterRetry(): boolean {
  if (!navigator.onLine) return false;
  stamp();
  window.location.reload();
  return true;
}

/** What a load that's about to be redone by a reload resolves to: nothing, ever (its page shows "loading" until then). */
export const holdForReload = () => new Promise<never>(() => {});
