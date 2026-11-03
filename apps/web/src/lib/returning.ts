/**
 * Remembers that this device has signed in before, so the sign-in page opens on "Вход" instead of "Регистрация". A
 * cookie (not just browser storage), so the server can draw that version of the landing page for it too.
 */
const COOKIE = 'almanac_returning';

export function isReturning(): boolean {
  return typeof document !== 'undefined' && document.cookie.split('; ').includes(`${COOKIE}=1`);
}

export function markReturning() {
  // 400 days: as long as browsers keep a cookie.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: one fixed value; the Cookie Store API isn't in every browser we serve (older Safari)
  document.cookie = `${COOKIE}=1; Path=/; Max-Age=${400 * 24 * 60 * 60}; SameSite=Lax${secure}`;
}
