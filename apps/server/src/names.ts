/**
 * Letters that look like another letter in the game's font: Cyrillic and Greek ones with a Latin twin in the same case,
 * and a capital I, which a sans-serif font draws like a lowercase l.
 */
const LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  Ё: 'Ë',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
  І: 'l',
  Ј: 'J',
  Ѕ: 'S',
  а: 'a',
  е: 'e',
  ё: 'ë',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  һ: 'h',
  ԁ: 'd',
  ӏ: 'l',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'l',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  α: 'a',
  ι: 'i',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  υ: 'u',
  I: 'l',
};

/**
 * How a name looks: two names with the same shape can't be told apart on screen ("Нristo" with a Cyrillic Н, and
 * "Hristo"). Case stays — "Hristo" and "hristo" are kept apart by the username key already, and "Lena" mustn't pass for
 * "Iena". Stored as users.username_shape: changing the table here needs a migration that recomputes it.
 */
export function nameShape(username: string): string {
  return [...username.normalize('NFC')].map((c) => LOOKALIKES[c] ?? c).join('');
}

// ─── Words nobody should see in a name ───────────────────────────────────────

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sht',
  ъ: 'a',
  ь: 'y',
  ю: 'yu',
  я: 'ya',
  ё: 'yo',
  ы: 'i',
  э: 'e',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lowercase Latin letters only: Cyrillic transliterated, leetspeak undone, separators dropped, repeats collapsed. */
function skeleton(text: string): string {
  // Transliterate on composed text first (NFKD would split "й" into "и" + a combining breve),
  // then decompose to strip any remaining accents from Latin letters.
  const latin = [...text.normalize('NFC').toLowerCase()]
    .map((c) => TRANSLIT[c] ?? LEET[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(/[^a-z]/g, '');
  return latin.replace(/(.)\1+/g, '$1');
}

// Substring matches (specific enough not to hit ordinary names).
const BLOCKED_STEMS = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'fagot',
  'whore',
  'bitch',
  'hitler',
  'nazi',
  'siegheil',
  'rapist',
  'pedophil',
  'pederas',
  'porn',
  'putk',
  'pichk',
  'kurv',
  'kurets',
  'kurec',
  'shiban',
  'dupedav',
  'duhach',
  'gazoliz',
  'layn',
  'ebalo',
  'ebach',
  'ebat',
  'ebem',
  'mamkati',
  'mamkamu',
  // Slurs for Roma, Jews, Black people and Albanians.
  'mangal',
  'zhid',
  'negar',
  'neger',
  'shiptar',
  'siptar',
];
// Short stems: only at the start or end of a word, so "Себастиан" or "Шухуй…" style names aren't caught by accident.
const BLOCKED_EDGES = ['huy', 'huj', 'pedal', 'heil'];
// What the game is called, and words that make a name pass for its staff.
const BRAND = ['almanac', 'almanah'];
const STAFF = ['admin', 'moderat', 'support', 'podrazhka', 'official', 'ofitsial'];

const wordsOf = (text: string) =>
  text
    .split(/[\s_.\-\d,;:!?„“"'()«»]+/u)
    .map(skeleton)
    .filter(Boolean);

/** Words nobody should read in a name: a blocked one anywhere in it, or a short one at a word's edge. */
export function hasBlockedWords(text: string): boolean {
  const whole = skeleton(text);
  if (BLOCKED_STEMS.some((s) => whole.includes(s))) return true;
  return wordsOf(text).some((w) => BLOCKED_EDGES.some((s) => w === s || w.startsWith(s) || w.endsWith(s)));
}

/** A name that passes for the game or its staff: one that starts like them, or has a word like „Модератор“ in it. */
export function passesForTheGame(text: string): boolean {
  const whole = skeleton(text);
  if ([...BRAND, ...STAFF, 'system', 'sistema'].some((p) => whole.startsWith(p))) return true;
  return wordsOf(text).some((w) => STAFF.some((p) => w.startsWith(p)));
}

/**
 * Why a name other players read, besides a username — a group's, a set's, a room nickname — can't be used, or null.
 * `what` names it in the message („Името на групата“).
 */
export function textProblem(text: string, what: string): string | null {
  if (hasBlockedWords(text)) return `${what} съдържа неподходящи думи.`;
  if (passesForTheGame(text)) return `${what} изглежда като на самата игра или на екипа ѝ — избери друго.`;
  return null;
}
