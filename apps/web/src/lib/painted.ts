/**
 * The server can send a page already drawn: the landing page to a visitor without a session (one version for a new
 * device, one for a device that has signed in before), and the legal pages (see paint.tsx). Search engines and a first
 * visit then get the page itself rather than a loading screen, and the app hydrates that markup instead of drawing it
 * again (main.tsx). Hydrating needs the app's first render to match the server's exactly: what the server knew is on
 * the root element, and the app reads it from there until its first render is done (paintingDone).
 */

/**
 * In the server's own render: always as for a visitor without a session (the store there is the initial one, nobody
 * signed in, and nothing to wait for).
 */
export const onServer = typeof document === 'undefined';

const root = onServer ? null : document.getElementById('root');

/** The landing page was drawn for a visitor without a session (read once, at startup). */
export const paintedSignedOut = root?.dataset.painted === 'signed-out';

/** The version of the landing page the server is drawing right now (paint.tsx sets it per version). */
let drawingReturning = false;
export function drawAs(version: { returning: boolean }) {
  drawingReturning = version.returning;
}

/** The page on screen is still the one the server drew (until the app's first render is done). */
export function isPainted(): boolean {
  return onServer || root?.hasAttribute('data-painted') === true;
}

/** The drawn landing page is the one for a device that has signed in before (the server read its cookie). */
export function paintedReturning(): boolean {
  return onServer ? drawingReturning : root?.dataset.returning === '1';
}

/** The app has taken over: from here on, everything on screen is its own (entrance animations and all). */
export function paintingDone() {
  root?.removeAttribute('data-painted');
  root?.removeAttribute('data-returning');
}
