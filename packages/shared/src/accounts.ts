/** The shortest password an account may have: the floor NIST SP 800-63B sets. The forms and the server both use it. */
export const PASSWORD_MIN_LENGTH = 8;

/** A player's name: 3–20 letters, digits, „.“, „-“ and „_“. The server checks it; the forms set the same limits. */
export const USERNAME = { min: 3, max: 20, chars: /^[\p{L}\p{N}_.-]+$/u } as const;

/** What a guest goes by in a room: 2–20 letters, digits, spaces, „.“, „-“ and „_“. */
export const ROOM_NICKNAME = { min: 2, max: 20, chars: /^[\p{L}\p{N} ._-]+$/u } as const;

/** A room name as it's kept: spaces run together and trimmed. */
export const tidyNickname = (name: string) => name.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** What's wrong with a room name (null: nothing), in the same words from the form and from the server. */
export function nicknameProblem(name: string): string | null {
  const n = tidyNickname(name);
  const length = [...n].length;
  if (length < ROOM_NICKNAME.min || length > ROOM_NICKNAME.max)
    return `Името е от ${ROOM_NICKNAME.min} до ${ROOM_NICKNAME.max} знака.`;
  if (!ROOM_NICKNAME.chars.test(n)) return 'Само букви, цифри и интервали.';
  return null;
}
