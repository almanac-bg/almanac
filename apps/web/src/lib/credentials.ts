/**
 * The server's checks on a name and password, made before the request and in its words. The forms that use this say
 * `noValidate`: the browser's own bubbles speak the device's language (often English), so the message goes in the
 * form's error box instead.
 */
export function credentialsProblem(
  username: string,
  password: string,
  { newAccount }: { newAccount: boolean },
): { field: 'username' | 'password'; message: string } | null {
  const name = username.trim();
  if (newAccount) {
    if (!name) return { field: 'username', message: 'Избери потребителско име.' };
    if (name.length < 3) return { field: 'username', message: 'Името трябва да е поне 3 символа.' };
    if (!password) return { field: 'password', message: 'Избери парола — поне 6 символа.' };
    if (password.length < 6) return { field: 'password', message: 'Паролата трябва да е поне 6 символа.' };
  } else {
    if (!name) return { field: 'username', message: 'Въведи име или имейл.' };
    if (!password) return { field: 'password', message: 'Въведи парола.' };
  }
  return null;
}
