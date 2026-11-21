// Words as Bulgarian says and writes them: those that change with the word after them, and where a word may break.

/** „с“ or „със“ before a word, a name or a number: „със“ where it's read starting with an с or a з, in either
 * alphabet, past an opening quote („със Заек 817“, „с Мечка 12“, „със „Светило“…“), or a number read so („със 7“,
 * „със 100 дни“, „с 20 дни“). */
export function withWord(text: string): string {
  const s = text.replace(/^„/, "");
  const number = /^\d+(?:[   ]\d{3})*/.exec(s)?.[0];
  const sz = number ? readsWithS(number.replace(/\D/g, "")) : /^([сз]|[sz](?!h))/i.test(s);
  return `${sz ? "със" : "с"} ${text}`;
}

/** Whether a whole number (its digits) is read in Bulgarian starting with an „с“: седем (7), седемнадесет (17),
 * седемдесет… (70–79), сто… (100–199), седемстотин… (700–799); past a thousand, as its leading group is read („сто
 * хиляди“, „седем хиляди“), except a lone one („хиляда“, „милион“). No numeral is read starting with a з. */
function readsWithS(digits: string): boolean {
  const d = digits.replace(/^0+(?=\d)/, "");
  const lead = Number(d.slice(0, d.length % 3 || 3));
  if (d.length > 3 && lead === 1) return false;
  if (lead >= 100) return [1, 7].includes(Math.floor(lead / 100));
  if (lead >= 10) return lead === 17 || Math.floor(lead / 10) === 7;
  return lead === 7;
}

/** A number as people write it in Bulgarian: a space between thousands from 10 000 up, a decimal comma, and the minus
 * sign „−“ below zero (as the pad has it), never a hyphen. */
export function formatNumber(n: number, step = 1): string {
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return new Intl.NumberFormat("bg", { maximumFractionDigits: decimals, useGrouping: Math.abs(n) >= 10000 })
    .format(n)
    .replace("-", "−");
}

/** A measured value as the bank gives it, every digit it has, whatever its size: an order's reveal shows a nanometre
 * (0,000000001 м) and π's approximations (3,14159 and 3,142857) apart, where two decimals would show both as 3,14. */
export function formatValue(n: number): string {
  return new Intl.NumberFormat("bg", { maximumSignificantDigits: 15, useGrouping: Math.abs(n) >= 10000 })
    .format(n)
    .replace("-", "−");
}

/** Several things in a sentence, as Bulgarian lists them: „Мария, Бо и Ци“. */
export function listWords(list: string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} и ${list.at(-1)}` : (list[0] ?? "");
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

/** The day of Брой 1 (play.FirstIssue). */
const firstIssue = Date.UTC(2026, 10, 12);

/** A day's issue (YYYY-MM-DD), as play.Issue counts it: 1 on 12 November 2026, one more each day after; 0 before. */
export function issueOf(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - firstIssue) / 86_400_000);
  return n >= 0 ? n + 1 : 0;
}

/** A day's issue (play/issue.go) and its date, as the game's dateline: „Брой 6 · 17 ноември“; the date alone without
 * one. */
export function issueWords(issue: number | undefined, day: string): string {
  return issue ? `Брой ${issue} · ${dateWords(day)}` : dateWords(day);
}

const vowel = /[аъоуеиюяѝ]/;
/** A stop or a hiss with р or л after it: they begin a syllable together. */
const onset = /^[бвгдзкпстфхжшчц][рл]$/;
/** Two consonants that begin a syllable together, more widely: a stop or a hiss with р, л or в, and с or ш with a
 * stop. */
const starts = /^([бвгдзкпстфхжшчц][рлв]|[сш][тпк])$/;

/** Where a word may break at a line's end, as soft hyphens, by the Bulgarian rules: by syllables; one consonant
 * between two vowels goes to the next line („ма-ма“); of two or more, the last does, or the last two where they begin
 * a syllable together („сес-тра“), so two of the same part („мост-та“); „ь“ never starts a line, „дж“ and „дз“ stay
 * together, no line keeps a single letter and none takes fewer than three (no „Преброяване-то“); a word under seven
 * letters fits any column whole. The browser breaks a word there, with a hyphen, instead of at any letter: no
 * browser knows Bulgarian hyphenation itself. It fills a line as far as a soft hyphen lets it, so every caller holds
 * each such word whole (questions.ts, wholeWords; ui.ts, nameWords): it goes to the next line whole where it fits there („Майкъл / Фарадей“, not „Фара-дей“), and
 * breaks only where it's wider than its line (a long name in large text at 320 px). */
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
        let cut = i - prev > 2 && (two[1] === "ь" || onset.test(two) || two === "дж" || two === "дз") ? i - 2 : i - 1;
        // Never fewer than three letters on to the next line: one consonant earlier, where the two begin a syllable
        // together („кралс-тво“), or not at all („Замръзналото“, „мостта“).
        if (w.length - cut < 3) cut = cut - 1 > prev && starts.test(w.slice(cut - 1, cut + 1)) ? cut - 1 : -1;
        if (cut >= 2 && w.length - cut >= 3) {
          out += `${word.slice(from, cut)}\u00ad`;
          from = cut;
        }
      }
      prev = i;
    }
    return out + word.slice(from);
  });
}

/** A number never parted from what it counts at a line's end: a no-break space between it and its unit or a short
 * word after it („135 °C“, „20 км“, „1878 г.“, „3 млн.“, „45 %“), and inside it („13 000“). The bank's text stays as
 * it is; only the line keeps them together (ui.ts, textWords). */
export function keepNumbers(text: string): string {
  return text
    .replace(/(\d)[ \t]+(?=\d{3}(?!\d))/g, "$1 ")
    .replace(/(\d)[ \t]+(?=(?:[°%‰]\S*|\p{L}{1,4}\.?)(?=[\s,;:.!?)“”»]|$))/gu, "$1 ");
}

/** How long a search of the book may be, in letters (play.AlmanacSearch). */
const searchLetters = 60;

/** A search of the book's facts as the server takes it (play.AlmanacOf): its first 60 letters in lower case, a word
 * between spaces each; a fact is found where it has every one. */
export function searchWords(query: string): string[] {
  return Array.from(query.trim().toLowerCase()).slice(0, searchLetters).join("").split(/\s+/).filter(Boolean);
}

/** Where a search's words (`searchWords`) are in a text, as [from, to) of it, in order and none over another: in any
 * case, as the server finds them, and across the soft hyphens `hyphenate` puts in a word (one at a match's edge stays
 * out of it). */
export function found(text: string, words: string[]): [number, number][] {
  if (!words.length) return [];
  // The text in lower case without its soft hyphens, and where each of its letters is in the text.
  let plain = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    if (ch !== "­")
      for (const c of ch.toLowerCase()) {
        plain += c;
        from.push(i);
        to.push(i + ch.length);
      }
    i += ch.length;
  }
  const spans: [number, number][] = [];
  for (const w of words)
    for (let at = plain.indexOf(w); at >= 0; at = plain.indexOf(w, at + 1))
      spans.push([from[at] ?? 0, to[at + w.length - 1] ?? 0]);
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out.at(-1);
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push(s);
  }
  return out;
}

/** The hour (in Bulgaria) from which a streak at stake says it ends at midnight. */
export const stakeHour = 18;

/** A streak at stake while the day's ten wait (`days`: in a row to yesterday; `spare`: whether this week would still
 * forgive the day missed; `hour`: in Bulgaria): what the ten make of it; from the evening, if the week has forgiven
 * its day already, that it ends at midnight. "" while there's no streak to lose. */
export function stakeWords(days: number, spare: boolean, hour: number): string {
  if (days < 1) return "";
  return hour >= stakeHour && !spare
    ? "Без днешния брой серията прекъсва в полунощ."
    : `С днешния брой серията ти става\u00a0${days + 1}.`;
}

/** How long an open duel has left, in words, rounded up (a duel just sent has „още 7 дни“, not six and some hours):
 * „още 2 дни“, „още 5 часа“, „по-малко от час“; each reads after a row's „·“, after „Иво има“ and „има време“. */
export function leftWords(until: number, now = Date.now()): string {
  const left = until - now;
  if (left < 3_600_000) return "по-малко от час";
  const hours = Math.ceil(left / 3_600_000);
  if (hours > 24) {
    const days = Math.ceil(hours / 24);
    return `още ${days} ${days === 1 ? "ден" : "дни"}`;
  }
  return hours === 1 ? "още 1 час" : `още ${hours} часа`;
}
