/**
 * The server's checks on a name and password, made before the request and in its words. The forms that use this say
 * `noValidate`: the browser's own bubbles speak the device's language (often English), so the message goes in the
 * form's error box instead.
 */
import { PASSWORD_MIN_LENGTH } from '@quiz/shared';

export function credentialsProblem(
  username: string,
  password: string,
  { newAccount }: { newAccount: boolean },
): { field: 'username' | 'password'; message: string } | null {
  const name = username.trim();
  if (newAccount) {
    if (!name) return { field: 'username', message: 'Избери потребителско име.' };
    if (name.length < 3) return { field: 'username', message: 'Името трябва да е поне 3 символа.' };
    if (!password) return { field: 'password', message: `Избери парола — поне ${PASSWORD_MIN_LENGTH} символа.` };
    if (password.length < PASSWORD_MIN_LENGTH)
      return { field: 'password', message: `Паролата трябва да е поне ${PASSWORD_MIN_LENGTH} символа.` };
    if (password.toLowerCase() === name.toLowerCase())
      return { field: 'password', message: 'Паролата не може да е същата като името.' };
  } else {
    if (!name) return { field: 'username', message: 'Въведи име или имейл.' };
    if (!password) return { field: 'password', message: 'Въведи парола.' };
  }
  return null;
}
