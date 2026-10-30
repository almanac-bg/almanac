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
  // A page loaded on demand draws a moment later: look for its heading for a little while.
  let tries = 0;
  const timer = setInterval(() => {
    const target =
      document.querySelector<HTMLElement>('main h1') ?? (tries > 10 ? document.querySelector('main') : null);
    if (!target && ++tries <= 20) return;
    clearInterval(timer);
    if (!target || target.contains(document.activeElement)) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, 50);
  return () => clearInterval(timer);
}
