// How the player's friends did with each of the day's questions, as its questions gone over say it (knew.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { friendsLine, groupWords, markAt, shortName } from "./knew.ts";

test("a friend's mark on a question: right, близо (not right), wrong, or one that counts for nobody", () => {
  const f = { name: "Ана", marks: "1203" };
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((n) => markAt(f, n)),
    ["right", "close", "wrong", "void", "wrong"],
  );
});

test("the line over a question's friends: how many got it, none as none, a few of many by name", () => {
  // One friend: the sign beside the name says it.
  assert.equal(friendsLine(["Ана"], 1), null);
  assert.equal(friendsLine([], 1), null);
  assert.equal(friendsLine([], 4), "Никой от приятелите ти не го позна.");
  assert.equal(friendsLine([], 23), "Никой от приятелите ти не го позна.");
  assert.equal(friendsLine(["А", "Б", "В"], 4), "Вярно отговарят 3 от 4 твои приятели.");
  assert.equal(friendsLine(["А"], 4), "Вярно отговаря 1 от 4 твои приятели.");
  assert.equal(
    friendsLine(["Стоян Тодоров", "Огнян Ангелов"], 23),
    "От 23 твои приятели го познаха само Стоян Тодоров и Огнян Ангелов.",
  );
  assert.equal(friendsLine(["Стоян Тодоров"], 5), "От 5 твои приятели го позна само Стоян Тодоров.");
  assert.equal(friendsLine(["А", "Б", "В", "Г"], 23), "Вярно отговарят 4 от 23 твои приятели.");
  assert.equal(friendsLine(["А", "Б", "В", "Г", "Д"], 5), "Вярно отговарят 5 от 5 твои приятели.");
});

test("a row of many friends names the first two and how many more, and up to three all", () => {
  assert.equal(shortName("Стоян Тодоров"), "Стоян");
  assert.equal(shortName(" Niki "), "Niki");
  assert.equal(shortName("Лисица 936"), "Лисица 936");
  assert.equal(groupWords(["Стоян Тодоров", "Огнян Ангелов"]), "Стоян и Огнян");
  assert.equal(groupWords(["Стоян Тодоров", "Огнян", "Елена99"]), "Стоян, Огнян и Елена99");
  assert.equal(groupWords(["Niki", "Йордан Йорданов", "А", "Б", "В"]), "Niki, Йордан и още\u00a03");
  assert.equal(groupWords(["Мария"]), "Мария");
});
