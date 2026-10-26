/**
 * Remembers that this device has signed in before, so the sign-in page opens on "Вход" instead of "Регистрация". A
 * cookie (not just browser storage), so the server can draw that version of the landing page for it too.
 */
const COOKIE = 'quiz_returning';
/** Where devices from before the cookie kept it. */
const LEGACY_KEY = 'quiz:returning';

const hasCookie = () => typeof document !== 'undefined' && document.cookie.split('; ').includes(`${COOKIE}=1`);

export function isReturning(): boolean {
  if (hasCookie()) return true;
  try {
    // window's, not the bare global: in the server's render (Node) that one exists only to print a warning.
    return window.localStorage.getItem(LEGACY_KEY) === '1';
  } catch {
    return false;
  }
}

export function markReturning() {
  // 400 days: as long as browsers keep a cookie.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: one fixed value; the Cookie Store API isn't in every browser we serve (older Safari)
  document.cookie = `${COOKIE}=1; Path=/; Max-Age=${400 * 24 * 60 * 60}; SameSite=Lax${secure}`;
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** A device that remembered it the old way: the cookie from now on (the server sees it on the next visit). */
export function upgradeReturning() {
  if (!hasCookie() && isReturning()) markReturning();
}
