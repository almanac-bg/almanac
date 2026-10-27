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
