// Words as Bulgarian says and writes them: those that change with the word after them, and where a word may break.

/** „с“ or „със“ before a name: „със“ before an с or a з, in either alphabet („със Заек 817“, „с Мечка 12“). */
export function withName(name: string): string {
  return `${/^([сз]|[sz](?!h))/i.test(name) ? "със" : "с"} ${name}`;
}

/** On a day of the week, as Bulgarian says it: „в събота“, „във вторник“ (`day` YYYY-MM-DD). */
export function onDay(day: string): string {
  const name = new Intl.DateTimeFormat("bg", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return `${/^[вф]/i.test(name) ? "във" : "в"} ${name}`;
}

const vowel = /[аъоуеиюяѝ]/;
/** A stop or a hiss with р or л after it: they begin a syllable together. */
const onset = /^[бвгдзкпстфхжшчц][рл]$/;

/** Where a word may break at a line's end, as soft hyphens, by the Bulgarian rules: by syllables; one consonant
 * between two vowels goes to the next line („ма-ма“); of two or more, the last does, or the last two where they begin
 * a syllable together („сес-тра“), so two of the same part („мост-та“); „ь“ never starts a line, „дж“ and „дз“ stay
 * together, and no line keeps or takes a single letter; a word under seven letters fits any column whole. The browser
 * breaks a word there, with a hyphen, only where it doesn't fit (a narrow column at 320 px), instead of at any letter:
 * no browser knows Bulgarian hyphenation itself. */
export function hyphenate(text: string): string {
  return text.replace(/[а-яѝ]{7,}/gi, (word) => {
    const w = word.toLowerCase();
    let out = "";
    let from = 0;
    let prev = -1;
    for (let i = 0; i < w.length; i++) {
      if (!vowel.test(w.charAt(i))) continue;
      if (prev >= 0 && i - prev > 1) {
        const two = w.slice(i - 2, i);
        const cut = i - prev > 2 && (two[1] === "ь" || onset.test(two) || two === "дж" || two === "дз") ? i - 2 : i - 1;
        if (cut >= 2 && w.length - cut >= 2) {
          out += `${word.slice(from, cut)}\u00ad`;
          from = cut;
        }
      }
      prev = i;
    }
    return out + word.slice(from);
  });
}
