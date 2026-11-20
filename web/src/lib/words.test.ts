import assert from "node:assert/strict";
import { test } from "node:test";
import { dateWords, formatNumber, hyphenate, issueOf, issueWords, stakeWords, weekday, withWord } from "./words.ts";

test("a day as the game writes it: the date, the month in lower case; with its issue, a dateline", () => {
  assert.equal(dateWords("2026-11-17"), "17 ноември");
  assert.equal(dateWords("2027-01-01"), "1 януари");
  assert.equal(weekday("2026-11-17"), "Вторник");
  assert.equal(issueWords(6, "2026-11-17"), "Брой 6 · 17 ноември");
  assert.equal(issueWords(0, "2026-11-11"), "11 ноември");
  assert.equal(issueWords(undefined, "2026-11-11"), "11 ноември");
});

test("a day's issue, as the server counts it (play.Issue)", () => {
  assert.equal(issueOf("2026-11-12"), 1);
  assert.equal(issueOf("2026-11-20"), 9);
  assert.equal(issueOf("2027-03-29"), 138); // across the clocks' change
  assert.equal(issueOf("2026-11-11"), 0);
});

test("„със“ before an с or a з, „с“ before anything else", () => {
  assert.deepEqual(["Заек 817", "Сова", "зора", "Мечка 12", "Ана", "Sasho", "Zara", "Shon", "Ivo"].map(withWord), [
    "със Заек 817",
    "със Сова",
    "със зора",
    "с Мечка 12",
    "с Ана",
    "със Sasho",
    "със Zara",
    "с Shon",
    "с Ivo",
  ]);
  assert.equal(withWord("„Светило“ в „История“"), "със „Светило“ в „История“");
  assert.equal(withWord("„Познавач“ в три теми"), "с „Познавач“ в три теми");
});

test("„със“ before a number read starting with an с: 7, 17, 70–79, 100–199, 700–799, and their thousands", () => {
  const sz = ["7", "17", "70", "77", "100", "150", "199", "700", "765", "7 000", "7000", "17 000", "100 000", "170000"];
  const s = [
    "0",
    "1",
    "2",
    "6",
    "8",
    "10",
    "16",
    "20",
    "27",
    "60",
    "80",
    "200",
    "365",
    "600",
    "1000",
    "1 000",
    "1 700",
  ];
  for (const n of sz) assert.equal(withWord(`${n} дни`), `със ${n} дни`, n);
  for (const n of s) assert.equal(withWord(`${n} дни`), `с ${n} дни`, n);
});

test("a word breaks by its syllables, as Bulgarian hyphenates", () => {
  const breaks = (text: string) => hyphenate(text).replaceAll("\u00ad", "-");
  assert.deepEqual(
    [
      "Независимостта", // one consonant goes on; two of the same part
      "Освобождението", // of two, the last goes on; the first letter never stays alone
      "Екстравагантни",
      "сестрата", // a stop and р begin a syllable together
      "метрото",
      "шампиньон", // „ь“ never starts a line
      "Лоджията", // „дж“ stays together
      "майката", // „й“ before a consonant stays
      "майорът",
      "Блестяща бяла",
    ].map(breaks),
    [
      "Не-за-ви-си-мост-та",
      "Ос-во-бож-де-ние-то",
      "Екс-тра-ва-гант-ни",
      "сес-тра-та",
      "ме-тро-то",
      "шам-пи-ньон",
      "Ло-джия-та",
      "май-ка-та",
      "ма-йо-рът",
      "Блес-тя-ща бяла",
    ],
  );
  // Words under seven letters, numbers, Latin and what's around a word stay as they are; a hyphen of its own is kept.
  assert.equal(breaks("„Хамлет“ — Копола, U2, 1885 г."), "„Хамлет“ — Копола, U2, 1885 г.");
  assert.equal(breaks("Сент-екзюпери"), "Сент-ек-зю-пе-ри");
  // A name after the first word goes to the next line whole, unless it's too long for a line of its own; a first word
  // (after a quote too) breaks as any.
  assert.equal(breaks("Майкъл Фарадей, Сент-Екзюпери"), "Майкъл Фарадей, Сент-Екзюпери");
  assert.equal(breaks("Куентин Тарантино"), "Куен-тин Та-ран-ти-но");
  assert.equal(breaks("„Списъкът на Шиндлер“"), "„Спи-съ-кът на Шиндлер“");
  // The text reads the same without them.
  assert.equal(hyphenate("Независимостта").replaceAll("\u00ad", ""), "Независимостта");
});

test("a streak at stake says what the day's ten make of it, and from 18:00 that it ends at midnight", () => {
  assert.equal(stakeWords(0, false, 20), ""); // nothing to lose
  assert.equal(stakeWords(1, false, 9), "Серия от 1 ден. С днешните въпроси става 2.");
  assert.equal(stakeWords(5, false, 17), "Серия от 5 дни. С днешните въпроси става 6.");
  assert.equal(stakeWords(5, false, 18), "Серия от 5 дни. Прекъсва в полунощ, ако не изиграеш въпросите на деня.");
  // The week would forgive the day: nothing ends at midnight.
  assert.equal(stakeWords(5, true, 23), "Серия от 5 дни. С днешните въпроси става 6.");
});

test("a number the Bulgarian way: a space between thousands from 10 000, a decimal comma, a minus sign, not a hyphen", () => {
  assert.equal(formatNumber(1380), "1380");
  assert.equal(formatNumber(12500), "12\u00a0500");
  assert.equal(formatNumber(6.25, 0.1), "6,3");
  assert.equal(formatNumber(-89.2, 0.1), "−89,2");
  assert.equal(formatNumber(-12500), "−12\u00a0500");
  assert.equal(formatNumber(-18), "−18");
});
