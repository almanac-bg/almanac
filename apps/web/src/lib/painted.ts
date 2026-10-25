/**
 * The server can send a page already drawn: the landing page to a visitor without a session, and the legal pages
 * (see paint.tsx). Search engines and a first visit then get the page itself rather than a loading screen, and the
 * app takes over the same markup in one go (main.tsx). On the landing page the server also knew that nobody was
 * signed in.
 */

/**
 * In the server's own render: always as for a visitor without a session (the store there is the initial one, nobody
 * signed in, and nothing to wait for).
 */
export const onServer = typeof document === 'undefined';

const root = onServer ? null : document.getElementById('root');

/** The page on screen came drawn (on the server, it's being drawn): entrance animations start finished. */
export const painted = onServer || root?.hasAttribute('data-painted') === true;
export const paintedSignedOut = root?.dataset.painted === 'signed-out';
