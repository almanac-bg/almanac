import assert from "node:assert/strict";
import { test } from "node:test";
import { dayShareText, duelShareText, yearShareText } from "./share.ts";
import type { Mark } from "./types.ts";

const right: Mark = { points: 1000, right: true };
const close: Mark = { points: 400, right: false, partial: true };
const wrong: Mark = { points: 0, right: false };

test("the day's result is shared as its issue and date, the score and streak, a square for each question, and the site", () => {
  const trail = [right, right, wrong, right, close, right, right, right, right, wrong];
  assert.equal(
    dayShareText("2026-11-14", 3, trail, 10, 12),
    ["АЛМАНАХ · Брой 3 · 14 ноември", "7 от 10 · серия 12", "🟩🟩⬜🟩🟨🟩🟩🟩🟩⬜", "almanac.bg"].join("\n"),
  );
});

test("a streak of one day isn't told, and a question not answered is a red square", () => {
  assert.equal(
    dayShareText("2027-01-01", 51, [right, close], 10, 1),
    ["АЛМАНАХ · Брой 51 · 1 януари", "1 от 10", "🟩🟨⬜⬜⬜⬜⬜⬜⬜⬜", "almanac.bg"].join("\n"),
  );
});

test("a question that counts for nobody that day has no square, and the result is out of the others", () => {
  const out: Mark = { points: 0, right: true, void: true };
  const trail = [right, right, out, right, close, right, right, right, right, wrong];
  assert.equal(
    dayShareText("2026-11-14", 3, trail, 10, 1),
    ["АЛМАНАХ · Брой 3 · 14 ноември", "7 от 9", "🟩🟩🟩🟨🟩🟩🟩🟩⬜", "almanac.bg"].join("\n"),
  );
});

test("nothing in it gives an answer away: only the date (a day before the first issue has none), numbers, squares and the site", () => {
  const text = dayShareText(
    "2026-05-09",
    0,
    [right, wrong, right, right, right, right, right, right, right, right],
    10,
    3,
  );
  assert.match(text, /^АЛМАНАХ · 9 май\n9 от 10 · серия 3\n[🟩🟨⬜]{10}\nalmanac\.bg$/u);
});

test("a right answer few of the day's players got is told, by its place and their share, never its answer", () => {
  const trail = [right, right, wrong, right, close, right, right, right, right, wrong];
  assert.equal(
    dayShareText("2026-11-14", 3, trail, 10, 12, { n: 6, right: 0.12 }),
    [
      "АЛМАНАХ · Брой 3 · 14 ноември",
      "7 от 10 · серия 12",
      "🟩🟩⬜🟩🟨🟩🟩🟩🟩⬜",
      "Познах въпрос 7, който знаят само 12%",
      "almanac.bg",
    ].join("\n"),
  );
  // A quarter is still few; nobody else is said so; more than a quarter, or none known, isn't told.
  assert.match(
    dayShareText("2026-11-14", 3, trail, 10, 1, { n: 0, right: 0.25 }),
    /\nПознах въпрос 1, който знаят само 25%\n/,
  );
  assert.match(
    dayShareText("2026-11-14", 3, trail, 10, 1, { n: 3, right: 0 }),
    /\nПознах въпрос 4, който не знае никой друг\n/,
  );
  for (const rarest of [{ n: 3, right: 0.26 }, null, undefined]) {
    assert.equal(dayShareText("2026-11-14", 3, trail, 10, 1, rarest).split("\n").length, 4);
  }
});

test("it ends with the player's own link, when there is one, and still has no words of invitation", () => {
  const trail = [right, right, wrong, right, close, right, right, right, right, wrong];
  const link = "https://almanac.bg/f/abcd2345";
  const text = dayShareText("2026-11-14", 3, trail, 10, 12, { n: 6, right: 0.12 }, link);
  assert.equal(text.split("\n").at(-1), link);
  assert.equal(text.split("\n").length, 5);
  assert.doesNotMatch(text, /ела|покан|играй|опитай|можеш|а ти/iu);
});

test("a year is shared as its days and streak, its answers, its strongest topic and facts, and the site", () => {
  assert.equal(
    yearShareText({ year: 2026, days: 42, streak: 12, answers: 1234, right: 839, topic: "История", facts: 312 }),
    [
      "Моята 2026 в АЛМАНАХ",
      "42 дни игра · серия 12",
      "1234 отговора, 68% верни",
      "Най-силна тема: История",
      "312 факта в Алманаха",
      "almanac.bg",
    ].join("\n"),
  );
  assert.equal(
    yearShareText({ year: 2026, days: 1, streak: 1, answers: 1, right: 0, facts: 0 }),
    ["Моята 2026 в АЛМАНАХ", "1 ден игра", "1 отговор, 0% верни", "almanac.bg"].join("\n"),
  );
});

test("a duel's win is shared as the day is: what it was and the score, no names and no words of invitation", () => {
  const text = duelShareText(5820, 1900, 6);
  assert.equal(text, "АЛМАНАХ · Дуел\nПобеда 5820 : 1900 · 6 от 10 верни");
  assert.match(duelShareText(12_340, 9870, 9), /^АЛМАНАХ · Дуел\nПобеда 12\s340 : 9870 · 9 от 10 верни$/);
  assert.doesNotMatch(text, /ела|покан|играй|опитай|можеш|а ти/iu);
});
