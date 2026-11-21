// The game speaks Bulgarian (CLAUDE.md): no letter Bulgarian doesn't have, none of the Russian words that have slipped
// in before, and none of the loanwords a Bulgarian word says as well, in anything a player may see — the client, the
// server's texts and mails, the sample bank.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "..");
const places = ["web/src", "web/public", "internal", "cmd", "bank/sample"];
const kinds = /\.(ts|go|css|html|json|webmanifest|txt)$/;

/** Letters of Russian (and other Cyrillic alphabets) that Bulgarian has none of. */
const letters = /[ёыэЁЫЭ]/u;

/**
 * The Russian words that look Bulgarian enough to pass unnoticed, and the loanwords that have crept in (each in the
 * forms it takes), with the Bulgarian words to use: one list, internal/bank/language.json, that `almanac bank check`
 * holds the questions to as well.
 */
const list = "internal/bank/language.json";
const { russian: words, loans } = JSON.parse(readFileSync(join(root, list), "utf8")) as {
  russian: Record<string, string>;
  loans: Record<string, string>;
};
const word = new RegExp(`(?<!\\p{L})(${Object.keys(words).join("|")})(?!\\p{L})`, "iu");
const loan = new RegExp(`(?<!\\p{L})(${Object.keys(loans).join("|")})(?!\\p{L})`, "iu");
const loanFor = (w: string) => Object.entries(loans).find(([k]) => k.split("|").includes(w.toLowerCase()))?.[1];

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* files(path);
    else if (kinds.test(e.name) && !e.name.endsWith("language.test.ts") && path !== list) yield path;
  }
}

test("everything a player may read is in Bulgarian letters and words, not loanwords", () => {
  const found: string[] = [];
  for (const place of places) {
    for (const path of files(place)) {
      readFileSync(join(root, path), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const l = line.match(letters);
          if (l) found.push(`${path}:${i + 1}: „${l[0]}“ isn't a Bulgarian letter`);
          const w = line.match(word);
          if (w?.[1]) found.push(`${path}:${i + 1}: „${w[1]}“ is Russian; say ${words[w[1].toLowerCase()]}`);
          const o = line.match(loan);
          if (o?.[1]) found.push(`${path}:${i + 1}: „${o[1]}“ is a loanword; say ${loanFor(o[1])}`);
        });
    }
  }
  assert.deepEqual(found, []);
});

/**
 * One thing, one name (DECISIONS.md, the closed list of nouns): the names a thing was once called beside its own, each
 * with the one to use. The day's ten are „броят“; the streak counts the days played, which needn't be in a row.
 */
const retired: [RegExp, string][] = [
  [/въпроси(те)? на деня|днешните въпроси/iu, "„днешният брой“ or „броят на деня“"],
  [/изиграни дни|дни поред/iu, "„дни в серията“ (the streak forgives missed days: not „поред“, not a total)"],
  [/игри на главите/iu, "what the game is: „игра на главата“ reads as a head's to one who hasn't played"],
];

test("a thing is called by its one name", () => {
  const found: string[] = [];
  for (const place of ["web/src", "web/public", "internal", "cmd"]) {
    for (const path of files(place)) {
      readFileSync(join(root, path), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const [was, now] of retired) {
            const m = line.match(was);
            if (m) found.push(`${path}:${i + 1}: „${m[0]}“; say ${now}`);
          }
        });
    }
  }
  assert.deepEqual(found, []);
});

/**
 * A chapter's name is in quotes only right after the word „глава“ („в глава „История““); standing alone it's bare
 * („Трудният въпрос е от История“, „Печат: История“): web/DESIGN.md, Copy.
 */
test("a chapter's name is quoted after „глава“ and only there", () => {
  const name = String.raw`\$\{(?:chapterName|nameOf|topicName)\(`;
  const alone = new RegExp(`(?<!глава )„${name}`, "u");
  const bare = new RegExp(`глава ${name}`, "u");
  const found: string[] = [];
  for (const path of files("web/src")) {
    if (path.endsWith(".test.ts")) continue;
    readFileSync(join(root, path), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (alone.test(line)) found.push(`${path}:${i + 1}: a chapter's name standing alone is bare`);
        if (bare.test(line)) found.push(`${path}:${i + 1}: a chapter's name after „глава“ is in quotes`);
      });
  }
  assert.deepEqual(found, []);
});

/**
 * „със“ before a word read starting with an с or a з („със Стефан Баторий“, „със звук“), „с“ before the rest: written
 * so in a fixed text, and through `withWord` (the client's lib/words.ts, the server's words.go) before a name, a number
 * or anything else that comes in (`${…}`, `{{…}}`, `%s`): DESIGN.md, Copy. A unit after a number („34,5 с срещу“)
 * isn't the word.
 */
test("„със“ before с and з, through withWord before what comes in", () => {
  const slip = /(?<![\p{L}\p{N}])(?<!\d[ \u00a0])[сС] ([сзСЗ]|\$\{|\{\{|%[sdv])/u;
  const found: string[] = [];
  for (const place of ["web/src", "web/public", "internal", "cmd"]) {
    for (const path of files(place)) {
      if (path.startsWith("internal/assets/dist") || /(\.test\.ts|_test\.go)$/.test(path)) continue;
      readFileSync(join(root, path), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(slip);
          if (m) found.push(`${path}:${i + 1}: „${m[0]}“; say „със“, or withWord(…)`);
        });
    }
  }
  assert.deepEqual(found, []);
});
