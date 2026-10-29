/**
 * The server's checks on a name and password, made before the request and in its words. The forms that use this say
 * `noValidate`: the browser's own bubbles speak the device's language (often English), so the message goes in the
 * form's error box instead.
 */
import { PASSWORD_MIN_LENGTH } from '@quiz/shared';

export type CredentialField = 'username' | 'password';

/** Everything wrong at once (at most one per field, the name's first), so a form says it all in one go. */
export function credentialsProblems(
  username: string,
  password: string,
  { newAccount }: { newAccount: boolean },
): { field: CredentialField; message: string }[] {
  const name = username.trim();
  const problems: { field: CredentialField; message: string }[] = [];
  if (newAccount) {
    if (!name) problems.push({ field: 'username', message: 'Избери потребителско име.' });
    else if (name.length < 3) problems.push({ field: 'username', message: 'Името трябва да е поне 3 символа.' });
    if (!password)
      problems.push({ field: 'password', message: `Избери парола — поне ${PASSWORD_MIN_LENGTH} символа.` });
    else if (password.length < PASSWORD_MIN_LENGTH)
      problems.push({ field: 'password', message: `Паролата трябва да е поне ${PASSWORD_MIN_LENGTH} символа.` });
    else if (name && password.toLowerCase() === name.toLowerCase())
      problems.push({ field: 'password', message: 'Паролата не може да е същата като името.' });
  } else {
    if (!name) problems.push({ field: 'username', message: 'Въведи име или имейл.' });
    if (!password) problems.push({ field: 'password', message: 'Въведи парола.' });
  }
  return problems;
}
