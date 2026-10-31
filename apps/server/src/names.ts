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
  // Ukrainian and Serbian letters, read as a Bulgarian would.
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ј: 'y',
  ѕ: 'dz',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Greek capitals and small letters drawn like a Cyrillic one: „Κурва“ is read as „Курва“. */
const GREEK_AS_CYRILLIC: Record<string, string> = {
  Α: 'а',
  Β: 'в',
  Γ: 'г',
  Δ: 'д',
  Ε: 'е',
  Η: 'н',
  Κ: 'к',
  Λ: 'л',
  Μ: 'м',
  Ο: 'о',
  Π: 'п',
  Ρ: 'р',
  Τ: 'т',
  Φ: 'ф',
  Χ: 'х',
  α: 'а',
  ε: 'е',
  κ: 'к',
  ο: 'о',
  π: 'п',
  ρ: 'р',
  τ: 'т',
  υ: 'у',
  φ: 'ф',
  χ: 'х',
};

/**
 * Letters read by their look, for the word check: like LOOKALIKES, but a capital I (and its Cyrillic and Greek twins)
 * stays an i here: „HITLER“ mustn't read as „hltler“.
 */
const SEEN: Record<string, string> = { ...LOOKALIKES, I: 'i', Ι: 'i', І: 'i', ӏ: 'i', ν: 'v', η: 'n', ι: 'i', μ: 'u' };

const CYRILLIC = /\p{Script=Cyrillic}/u;
const spell = (c: string) => {
  const lower = GREEK_AS_CYRILLIC[c] ?? c.toLowerCase();
  return TRANSLIT[lower] ?? LEET[lower] ?? lower;
};
const see = (c: string) => {
  const lower = (SEEN[c] ?? c).toLowerCase();
  return TRANSLIT[lower] ?? LEET[lower] ?? lower;
};
/** One character's letters: lowercase Latin only, accents stripped, anything that isn't a letter dropped. */
const latin = (s: string) => s.normalize('NFKD').replace(/[^a-z]/g, '');

/**
 * A name's letters two ways. As spelled: Cyrillic transliterated, Greek read as its Cyrillic twin, leetspeak undone
 * („Хитлер“, „Κурва“, „pu7ka“). As seen: every look-alike read as the Latin letter it looks like („Нitler“ with a
 * Cyrillic Н, „fuсk“ with a Cyrillic с, „Αdmin“ with a Greek Α), with a mark on each letter that came from a Cyrillic
 * one. Repeats stay (see `pattern`).
 */
function readings(text: string): Reading {
  // Composed first: NFKD would split „й“ into „и“ and a combining breve before it's transliterated.
  const chars = [...text.normalize('NFC')];
  let seen = '';
  const native: boolean[] = [];
  for (const c of chars) {
    const letters = latin(see(c));
    seen += letters;
    for (let i = 0; i < letters.length; i++) native.push(CYRILLIC.test(c));
  }
  return { spelled: chars.map((c) => latin(spell(c))).join(''), seen, native };
}
type Reading = { spelled: string; seen: string; native: boolean[] };

/**
 * Whether a word shows in a name. As seen, only a match with a letter that isn't Cyrillic counts: „Нitler“ is a
 * disguise, but Bulgarian words read by their look aren't („горичка“ would read „gopichka“ with р as p).
 */
function shows(r: Reading, p: RegExp): boolean {
  if (p.test(r.spelled)) return true;
  for (const m of r.seen.matchAll(new RegExp(p.source, 'g')))
    if (r.native.slice(m.index, m.index + m[0].length).some((n) => !n)) return true;
  return false;
}

/**
 * A word as a pattern that lets each letter repeat: „fuck“ catches „fuuuck“, and a doubled letter stays at least
 * doubled, so „nigg“ catches „Niiigger“ but not „Niger“ or „Nigel“. (Collapsing repeats in the name instead once made
 * every listed word with a double letter dead.)
 */
function pattern(word: string, where: 'anywhere' | 'start' | 'end'): RegExp {
  const runs = word.replace(/(.)\1*/g, (run, c: string) => (run.length > 1 ? `${c}{${run.length},}` : `${c}+`));
  return new RegExp(where === 'start' ? `^${runs}` : where === 'end' ? `${runs}$` : runs);
}

// Substring matches (specific enough not to hit ordinary names). Lowercase Latin, written as said: a double letter only
// where the word has one.
export const BLOCKED_STEMS = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'fagot',
  'whore',
  'bitch',
  'pussy',
  'slut',
  'retard',
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
  'ebam',
  'ebem',
  'ebanat',
  'mamkati',
  'mamkamu',
  // Slurs for Roma, Jews, Black people and Albanians.
  'mangal',
  'zhid',
  'chifut',
  'negar',
  'neger',
  'shiptar',
  'siptar',
];
// Short stems: only at the start or end of a word, so „Себастиан“ or „Шухуй…“ style names aren't caught by accident.
export const BLOCKED_EDGES = ['huy', 'huj', 'pedal', 'heil'];
// …and some only at the start („Ебах те“, but not „Гризебах“).
export const BLOCKED_STARTS = ['ebah'];
// Neo-Nazi number codes, read off the name with its digits. 1488 is also a year a set's name may give, so it's refused
// in usernames only.
const BLOCKED_CODES = /hh88/;
const USERNAME_CODES = /1488|hh88/;
// What the game is called, and words that make a name pass for its staff.
export const BRAND = ['almanac', 'almanah'];
export const STAFF = ['admin', 'moderat', 'support', 'podrazhka', 'official', 'ofitsial', 'oficial'];
const SYSTEM = ['system', 'sistema'];

const STEMS = BLOCKED_STEMS.map((w) => pattern(w, 'anywhere'));
const EDGES = [
  ...BLOCKED_EDGES.flatMap((w) => [pattern(w, 'start'), pattern(w, 'end')]),
  ...BLOCKED_STARTS.map((w) => pattern(w, 'start')),
];
const STARTS = [...BRAND, ...STAFF, ...SYSTEM].map((w) => pattern(w, 'start'));
const STAFF_STARTS = STAFF.map((w) => pattern(w, 'start'));

const SEPARATORS = /[\s_.\-\d,;:!?„“"'()«»]+/u;
const wordsOf = (text: string) => text.split(SEPARATORS).filter(Boolean);
const any = (text: string, patterns: RegExp[]) => {
  const r = readings(text);
  return patterns.some((p) => shows(r, p));
};
const codesOf = (text: string) =>
  [...text.normalize('NFKC')]
    .map((c) => (SEEN[c] ?? c).toLowerCase())
    .join('')
    .replace(/[^a-z0-9]/g, '');

/**
 * Words nobody should read in a name: a blocked one anywhere in it, a short one at a word's edge, a number code. A
 * username is also refused 1488.
 */
export function hasBlockedWords(text: string, { username = false } = {}): boolean {
  if (any(text, STEMS)) return true;
  if ((username ? USERNAME_CODES : BLOCKED_CODES).test(codesOf(text))) return true;
  return wordsOf(text).some((w) => any(w, EDGES));
}

/** A name that passes for the game or its staff: one that starts like them, or has a word like „Модератор“ in it. */
export function passesForTheGame(text: string): boolean {
  return any(text, STARTS) || wordsOf(text).some((w) => any(w, STAFF_STARTS));
}

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

/**
 * A word written in two alphabets at once — „Нristo“ with a Cyrillic Н, „Αdmin“ with a Greek Α: nobody types that by
 * accident, and it's how a name slips past the checks or passes for someone else's. Whole names may mix („Badminton
 * клуб“); a single word may not.
 */
export function mixesScripts(text: string): boolean {
  return wordsOf(text.normalize('NFC')).some((w) => SCRIPTS.filter((s) => s.test(w)).length > 1);
}

/**
 * Why a name other players read, besides a username — a group's, a set's, a room nickname — can't be used, or null.
 * `what` names it in the message („Името на групата“).
 */
export function textProblem(text: string, what: string): string | null {
  if (hasBlockedWords(text)) return `${what} съдържа неподходящи думи.`;
  if (passesForTheGame(text)) return `${what} изглежда като на самата игра или на екипа ѝ — избери друго.`;
  if (mixesScripts(text)) return `${what} смесва латиница и кирилица (или гръцки) в една дума — напиши я с едната.`;
  return null;
}
