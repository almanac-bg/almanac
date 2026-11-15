import assert from "node:assert/strict";
import { test } from "node:test";
import { hyphenate, withName } from "./words.ts";

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
