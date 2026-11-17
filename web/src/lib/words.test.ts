import assert from "node:assert/strict";
import { test } from "node:test";
import { dateWords, hyphenate, issueWords, stakeWords, weekday, withName } from "./words.ts";

test("a day as the game writes it: the date, the month in lower case; with its issue, a dateline", () => {
  assert.equal(dateWords("2026-11-17"), "17 ноември");
  assert.equal(dateWords("2027-01-01"), "1 януари");
  assert.equal(weekday("2026-11-17"), "Вторник");
  assert.equal(issueWords(6, "2026-11-17"), "Брой 6 · 17 ноември");
  assert.equal(issueWords(0, "2026-11-11"), "11 ноември");
  assert.equal(issueWords(undefined, "2026-11-11"), "11 ноември");
});

test("„със“ before an с or a з, „с“ before anything else", () => {
  assert.deepEqual(["Заек 817", "Сова", "зора", "Мечка 12", "Ана", "Sasho", "Zara", "Shon", "Ivo"].map(withName), [
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
  assert.equal(breaks("Сент-Екзюпери"), "Сент-Ек-зю-пе-ри");
  // The text reads the same without them.
  assert.equal(hyphenate("Независимостта").replaceAll("\u00ad", ""), "Независимостта");
});

test("a streak at stake says what the day's ten make of it, and from 18:00 that it ends at midnight", () => {
  assert.equal(stakeWords(0, 0, 20), ""); // nothing to lose
  assert.equal(stakeWords(1, 0, 9), "Серия от 1 ден. С днешните въпроси става 2.");
  assert.equal(stakeWords(5, 0, 17), "Серия от 5 дни. С днешните въпроси става 6.");
  assert.equal(stakeWords(5, 0, 18), "Серия от 5 дни. Прекъсва в полунощ, ако не изиграеш въпросите на деня.");
  // A reserve day would keep it: nothing ends at midnight.
  assert.equal(stakeWords(5, 1, 23), "Серия от 5 дни. С днешните въпроси става 6.");
});
