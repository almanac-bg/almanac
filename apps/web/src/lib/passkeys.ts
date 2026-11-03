import { ApiError, api, errorMessage } from '@almanac/client';

/**
 * Passkeys for staff (apps/server/src/passkeys.ts): the browser's part of WebAuthn, through @simplewebauthn/browser,
 * fetched only when a staff member uses one (no one else downloads it).
 */
const library = () => import('@simplewebauthn/browser');

/** This browser can make and use passkeys at all (every current one can; an old or locked-down one may not). */
export const passkeysWork = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

/** A new passkey for this staff member: the device asks for its own unlocking (a face, a finger, a PIN, a key's touch). */
export async function addPasskey() {
  const { startRegistration } = await library();
  const optionsJSON = (await api.passkeyCreationOptions()) as unknown as Parameters<
    typeof startRegistration
  >[0]['optionsJSON'];
  await api.addPasskey(await startRegistration({ optionsJSON }));
}

/** This session's second factor, with one of this staff member's passkeys. */
export async function signInWithPasskey() {
  const { startAuthentication } = await library();
  const optionsJSON = (await api.passkeyRequestOptions()) as unknown as Parameters<
    typeof startAuthentication
  >[0]['optionsJSON'];
  await api.givePasskey(await startAuthentication({ optionsJSON }));
}

/** What went wrong with a passkey, in words: the browser's, the device's or the server's. */
export function passkeyProblem(err: unknown): string {
  if (err instanceof ApiError) return errorMessage(err);
  const error = err as { name?: string; code?: string; cause?: { name?: string } } | null;
  if (error?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'Този ключ вече е добавен.';
  // The person said no, closed the window, or let it time out: the browser says only that much.
  if (error?.name === 'NotAllowedError' || error?.cause?.name === 'NotAllowedError' || error?.name === 'AbortError')
    return 'Не стана: прозорецът за ключа беше затворен или времето изтече. Опитай пак.';
  return 'Ключът за достъп не проработи на това устройство. Опитай пак или с кода от приложението.';
}
