/**
 * Code that was about to be shown didn't arrive. A tab opened before a deploy asks for files that are gone: one reload
 * gets the new version. Not while offline (that would only swap the app for the offline page), and not twice in a
 * row. Only for code being shown: a background fetch that fails (prefetchPages) mustn't reload the app under the
 * player, taking whatever they were typing with it.
 */
export function reloadForNewVersion() {
  if (!navigator.onLine) return;
  try {
    if (Date.now() - Number(sessionStorage.getItem('quiz:reloadedAt') ?? 0) < 10_000) return; // already tried
    sessionStorage.setItem('quiz:reloadedAt', String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway */
  }
  window.location.reload();
}
