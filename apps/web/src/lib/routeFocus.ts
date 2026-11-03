import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * After moving to another page in the app, the focus goes to its heading (or the page itself), as a full page load
 * would put it at the top: a screen reader reads where you are, and Tab goes on from there instead of from a link on
 * the page you left. Not on the first load, not within a page (?tab=…), not into a match (it focuses its question).
 */
export function useRouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pathname === '/game') return;
    return focusPageHeading();
  }, [pathname]);
}

/**
 * The focus on the page's heading (or the page itself) once it's drawn: after a move, and after signing in, which opens
 * the lobby on the same address (the sign-in form had the focus, and it's gone). Returns a way to stop looking.
 */
export function focusPageHeading(): () => void {
  // Where the focus was when the move began (the link, or nothing once the page it was on went away).
  const before = document.activeElement;
  // A page loaded on demand draws a moment later: look for its heading for a little while.
  let tries = 0;
  const timer = setInterval(() => {
    // Someone already chose a place on the new page (tapped a field, or a test typed into one): it stays there.
    // Taking it to the heading between a tap and the typing sent the text nowhere (the 31 October review, REPO-1).
    const main = document.querySelector('main');
    const now = document.activeElement;
    if (now !== before && now !== main && main?.contains(now)) return clearInterval(timer);
    const target = document.querySelector<HTMLElement>('main h1') ?? (tries > 10 ? main : null);
    if (!target && ++tries <= 20) return;
    clearInterval(timer);
    if (!target || target.contains(document.activeElement)) return;
    focusForNow(target);
  }, 50);
  return () => clearInterval(timer);
}

/**
 * The focus on something that isn't a control (the page's heading, the page itself), for this once: it's focusable
 * only until the focus leaves it. Always focusable (tabindex -1 for good), the page took the focus on every tap of its
 * plain text, and the browser then scrolled it to its top — on a phone in a room, a tap on a line of text jumped the
 * page (and the start button's bar then took it down to its end: lib/bottomBar.ts).
 */
export function focusForNow(target: HTMLElement) {
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
}
