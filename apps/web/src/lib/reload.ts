/**
 * Code that was about to be shown didn't arrive. A tab opened before a deploy asks for files that are gone: one reload
 * gets the new version. Not while offline (that would only swap the app for the offline page), and not twice in a
 * row. Only for code being shown: a background fetch that fails (prefetchPages) mustn't reload the app under the
 * player, taking whatever they were typing with it.
 */
/** Long enough for a navigation away to take the page with it, short enough that a reload still feels prompt. */
const LEAVING_MS = 1500;

export function reloadForNewVersion() {
  if (!navigator.onLine) return;
  // A moment first. A download cut short because the page is being left (a link out, a typed address) fails the same
  // way, and a reload then took that navigation over; a page being left is gone before this runs.
  setTimeout(() => {
    try {
      if (Date.now() - Number(sessionStorage.getItem('quiz:reloadedAt') ?? 0) < 10_000) return; // already tried
      sessionStorage.setItem('quiz:reloadedAt', String(Date.now()));
    } catch {
      /* storage unavailable: reload anyway */
    }
    window.location.reload();
  }, LEAVING_MS);
}
