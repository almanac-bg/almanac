import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateWords,
  formatNumber,
  formatValue,
  found,
  hyphenate,
  issueOf,
  issueWords,
  keepNumbers,
  leftWords,
  searchWords,
  stakeWords,
  weekday,
  withWord,
} from "./words.ts";

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
  // A name breaks as any word (its caller holds it whole where it fits: wholeWords, nameWords), after a quote too.
  assert.equal(breaks("Майкъл Фарадей, Сент-Екзюпери"), "Майкъл Фа-ра-дей, Сент-Ек-зю-пе-ри");
  assert.equal(breaks("Куентин Тарантино"), "Куен-тин Та-ран-ти-но");
  assert.equal(breaks("„Списъкът на Шиндлер“"), "„Спи-съ-кът на Шин-длер“");
  assert.equal(breaks("Долф Лундгрен"), "Долф Лунд-грен");
  // The text reads the same without them.
  assert.equal(hyphenate("Независимостта").replaceAll("\u00ad", ""), "Независимостта");
});

test("a streak at stake says what the day's ten make of it, and from 18:00 that it ends at midnight", () => {
  assert.equal(stakeWords(0, false, 20), ""); // nothing to lose
  assert.equal(stakeWords(1, false, 9), "С днешния брой серията ти става\u00a02.");
  assert.equal(stakeWords(5, false, 17), "С днешния брой серията ти става\u00a06.");
  assert.equal(stakeWords(5, false, 18), "Без днешния брой серията прекъсва в полунощ.");
  // The week would forgive the day: nothing ends at midnight.
  assert.equal(stakeWords(5, true, 23), "С днешния брой серията ти става\u00a06.");
});

test("a number the Bulgarian way: a space between thousands from 10 000, a decimal comma, a minus sign, not a hyphen", () => {
  assert.equal(formatNumber(1380), "1380");
  assert.equal(formatNumber(12500), "12\u00a0500");
  assert.equal(formatNumber(6.25, 0.1), "6,3");
  assert.equal(formatNumber(-89.2, 0.1), "−89,2");
  assert.equal(formatNumber(-12500), "−12\u00a0500");
  assert.equal(formatNumber(-18), "−18");
});

test("an order's value with every digit it has: a nanometre isn't 0, π's approximations stay apart", () => {
  assert.equal(formatValue(1e-9), "0,000000001");
  assert.equal(formatValue(0.0004), "0,0004");
  assert.equal(formatValue(1.23456), "1,23456");
  assert.equal(formatValue(3.142857), "3,142857");
  assert.equal(formatValue(95.16), "95,16");
  assert.equal(formatValue(1411778724), "1\u00a0411\u00a0778\u00a0724");
  assert.equal(formatValue(2022), "2022");
  assert.equal(formatValue(-570), "−570");
});

test("how long a duel has left, rounded up, as it reads after „Иво има“ and „има време“", () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const hour = 3_600_000;
  assert.equal(leftWords(now + 7 * 24 * hour, now), "още 7 дни");
  assert.equal(leftWords(now + 24 * hour + 1, now), "още 2 дни");
  assert.equal(leftWords(now + 24 * hour, now), "още 24 часа");
  assert.equal(leftWords(now + 5 * hour - 1, now), "още 5 часа");
  assert.equal(leftWords(now + hour, now), "още 1 час");
  assert.equal(leftWords(now + hour - 1, now), "по-малко от час");
  assert.equal(leftWords(now + 60_000, now), "по-малко от час");
  assert.equal(`Иво има ${leftWords(now + 60_000, now)}`, "Иво има по-малко от час");
});

test("a number stays with its unit, a short word after it, and its own thousands at a line's end", () => {
  const nb = " ";
  assert.equal(keepNumbers("Кипи при 135 °C."), `Кипи при 135${nb}°C.`);
  assert.equal(keepNumbers("на 20 км от 1878 г. насам"), `на 20${nb}км от 1878${nb}г. насам`);
  assert.equal(keepNumbers("около 3 млн. души, 45 % от тях"), `около 3${nb}млн. души, 45${nb}% от тях`);
  assert.equal(keepNumbers("13 000 реда"), `13${nb}000${nb}реда`);
  assert.equal(keepNumbers("през 2010 година"), "през 2010 година");
});

test("a search's words as the server takes them: in lower case, between spaces, its first 60 letters", () => {
  assert.deepEqual(searchWords("  Дунав   ЧЕРНО\tморе "), ["дунав", "черно", "море"]);
  assert.deepEqual(searchWords(""), []);
  assert.deepEqual(searchWords("   "), []);
  assert.equal(searchWords(`${"а".repeat(58)} бвг`).join(" "), `${"а".repeat(58)} б`);
});

test("what a search found in a text: in any case, every place, across the soft hyphens a long word gets", () => {
  // Marked as the text shows it: the soft hyphens in, `found` over them.
  const mark = (text: string, words: string[]) => {
    let out = "";
    let at = 0;
    for (const [from, to] of found(text, words)) {
      out += `${text.slice(at, from)}[${text.slice(from, to)}]`;
      at = to;
    }
    return (out + text.slice(at)).replaceAll("­", "-");
  };
  assert.equal(mark("Дунав и дунавът", searchWords("ДУНАВ")), "[Дунав] и [дунав]ът");
  // Across the soft hyphens of „Съе-ди-не-ние-то“; one at the match's edge stays out of it.
  const united = hyphenate("Съединението");
  assert.equal(mark(united, ["единение"]), "Съ[е-ди-не-ние]-то");
  assert.equal(mark(united, ["ди"]), "Съе-[ди]-не-ние-то");
  assert.equal(mark(united, ["то"]), "Съе-ди-не-ние-[то]");
  // Two words over one another are one mark; none where nothing was searched or nothing is there.
  assert.equal(mark("Независимостта", ["неза", "зави"]), "[Незави]симостта");
  assert.equal(mark(hyphenate("независимостта"), ["мостта"]), "не-за-ви-си-[мост-та]");
  assert.deepEqual(found("Дунав", []), []);
  assert.deepEqual(found("Дунав", ["волга"]), []);
  // A number the line keeps whole (keepNumbers) is found by its digits.
  assert.equal(mark(keepNumbers("през 1878 г."), ["1878"]), "през [1878]\u00a0г.");
});
