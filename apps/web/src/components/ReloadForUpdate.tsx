import { getState, useStore } from '@quiz/client';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

/** The build this page's code came from (stamped in by vite.config.ts; missing in development). */
const build = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content;

const idle = () => {
  const { game, room, queue } = getState();
  return !game && !room && !queue;
};

/** Text typed into the page (a question being written, a password form): a reload would throw it away. */
function holdsTypedText() {
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].some(
    (el) => !['hidden', 'checkbox', 'radio'].includes(el.type) && !el.readOnly && el.value !== '',
  );
}

function reload(latest: string) {
  try {
    // Once per build: should the page somehow still be the old one, keep running rather than reload for ever.
    if (sessionStorage.getItem('quiz:reloadedFor') === latest) return;
    sessionStorage.setItem('quiz:reloadedFor', latest);
  } catch {
    return;
  }
  window.location.reload();
}

/**
 * A deploy since this tab loaded: the server runs a newer game than this page's code, and the two may no longer
 * understand each other. The page reloads into the new version at a moment that costs nothing: not in a match, a room
 * or a queue, and not over typed text (then on the next page change, or once the tab is in the background).
 */
export function ReloadForUpdate() {
  const latest = useStore((s) => s.lobby?.build ?? null);
  const busy = useStore((s) => !!(s.game || s.room || s.queue));
  const { pathname } = useLocation();
  const outdated = !!build && !!latest && latest !== build;

  // On a change of page (a natural moment to load), or a couple of seconds into a quiet one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is a reason to check again
  useEffect(() => {
    if (!outdated || busy) return;
    const t = setTimeout(() => {
      if (idle() && (document.hidden || !holdsTypedText())) reload(latest);
    }, 2000);
    return () => clearTimeout(t);
  }, [outdated, busy, latest, pathname]);

  useEffect(() => {
    if (!outdated) return;
    const hidden = () => {
      if (document.hidden && idle()) reload(latest);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [outdated, latest]);

  return null;
}
