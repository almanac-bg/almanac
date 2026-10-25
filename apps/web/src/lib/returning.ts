/** Remembers that this device has signed in before, so the sign-in page opens on "Вход" instead of "Регистрация". */
const KEY = 'quiz:returning';

export function isReturning(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markReturning() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable */
  }
}
