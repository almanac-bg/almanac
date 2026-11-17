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

/** A day's weekday (`day` YYYY-MM-DD), with a capital: „Вторник“. */
export function weekday(day: string): string {
  const name = new Intl.DateTimeFormat("bg", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const months = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];

/** A day (YYYY-MM-DD) as the game writes it: „17 ноември“, the month in lower case. */
export function dateWords(day: string): string {
  const [, month = 1, date = 1] = day.split("-").map(Number);
  return `${date} ${months[month - 1]}`;
}

/** A day's issue (play/issue.go) and its date, as the game's dateline: „Брой 6 · 17 ноември“; the date alone without
 * one. */
export function issueWords(issue: number | undefined, day: string): string {
  return issue ? `Брой ${issue} · ${dateWords(day)}` : dateWords(day);
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

/** The hour (in Bulgaria) from which a streak at stake says it ends at midnight. */
export const stakeHour = 18;

/** A streak at stake while the day's ten wait (`days`: in a row to yesterday; `reserve`: days in hand; `hour`: in
 * Bulgaria): what the ten make of it; from the evening, if no reserve day would keep it, that it ends at midnight.
 * "" while there's no streak to lose. */
export function stakeWords(days: number, reserve: number, hour: number): string {
  if (days < 1) return "";
  const streak = `Серия от ${days} ${days === 1 ? "ден" : "дни"}.`;
  return hour >= stakeHour && !reserve
    ? `${streak} Прекъсва в полунощ, ако не изиграеш днешните.`
    : `${streak} С днешните въпроси става ${days + 1}.`;
}
