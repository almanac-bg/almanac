import { useEffect, useRef } from 'react';

/*
 * The browser's back button during a match. Left alone it drops the player on Home while the match plays on without
 * them. So the match screen keeps one extra history entry on top of /game: back steps down onto the real /game entry,
 * we put the guard back and ask instead. The guard comes off again whenever the match screen goes away, so history
 * after the match (results, home) is exactly what it would have been without it.
 */

const MARK = 'matchGuard';

const onGuard = () => !!(window.history.state as Record<string, unknown> | null)?.[MARK];

function arm() {
  if (!onGuard()) window.history.pushState({ ...window.history.state, [MARK]: true }, '');
}

/** The mounted match screen's back handler. */
let onBack: (() => void) | null = null;
/** Our own step back is in flight: what to run when it lands (it isn't the player pressing back). */
let landing: (() => void) | null = null;

window.addEventListener('popstate', () => {
  if (landing) {
    const then = landing;
    landing = null;
    return then();
  }
  // Already somewhere else (e.g. a long-press on back skipped several entries): the "match is on" bar takes over.
  if (!onBack || onGuard() || window.location.pathname !== '/game') return;
  arm();
  onBack();
});

/**
 * Steps off the guard entry (if we're on it), then runs `then`. (The browser doesn't move the page for it: the app
 * restores no scroll positions, see main.tsx, so the results don't open where the lobby was scrolled.)
 */
function stepOff(then: () => void) {
  if (!onGuard()) return then();
  landing = then;
  window.history.back();
}

/** While mounted, the back button calls `handleBack` instead of leaving /game. */
export function useBackGuard(handleBack: () => void) {
  const latest = useRef(handleBack);
  useEffect(() => {
    latest.current = handleBack;
  });

  useEffect(() => {
    const mine = () => latest.current();
    onBack = mine;
    // A remount right after an unmount (StrictMode does this): that cleanup's step back hasn't landed yet.
    if (landing) landing = arm;
    else arm();
    return () => {
      if (onBack === mine) onBack = null;
      stepOff(() => {});
    };
  }, []);
}

/** Leave the match screen for good: off the guard first, so whatever replaces /game leaves no dead entry behind. */
export function leaveMatchScreen(then: () => void) {
  onBack = null;
  stepOff(then);
}
