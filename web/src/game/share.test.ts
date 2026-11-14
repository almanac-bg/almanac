import assert from "node:assert/strict";
import { test } from "node:test";
import { dayShareText } from "./share.ts";
import type { Mark } from "./types.ts";

const right: Mark = { points: 1000, right: true };
const close: Mark = { points: 400, right: false, partial: true };
const wrong: Mark = { points: 0, right: false };

test("the day's result is shared as the date, the score and streak, a square for each question, and the site", () => {
  const trail = [right, right, wrong, right, close, right, right, right, right, wrong];
  assert.equal(
    dayShareText("2026-11-14", trail, 10, 12),
    ["АЛМАНАХ · 14 ноември", "7 от 10 · серия 12", "🟩🟩🟥🟩🟨🟩🟩🟩🟩🟥", "almanac.bg"].join("\n"),
  );
});

test("a streak of one day isn't told, and a question not answered is a red square", () => {
  assert.equal(
    dayShareText("2027-01-01", [right, close], 10, 1),
    ["АЛМАНАХ · 1 януари", "1 от 10", "🟩🟨🟥🟥🟥🟥🟥🟥🟥🟥", "almanac.bg"].join("\n"),
  );
});

test("nothing in it gives an answer away: only the date, numbers, squares and the site", () => {
  const text = dayShareText(
    "2026-05-09",
    [right, wrong, right, right, right, right, right, right, right, right],
    10,
    3,
  );
  assert.match(text, /^АЛМАНАХ · 9 май\n9 от 10 · серия 3\n[🟩🟨🟥]{10}\nalmanac\.bg$/u);
});
