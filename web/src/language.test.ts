// The game speaks Bulgarian (CLAUDE.md): no letter Bulgarian doesn't have, and none of the Russian words that have
// slipped in before, in anything a player may see — the client, the server's texts and mails, the sample bank.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "..");
const places = ["web/src", "web/public", "internal", "cmd", "bank/sample"];
const kinds = /\.(ts|go|css|html|json|webmanifest|txt)$/;

/** Letters of Russian (and other Cyrillic alphabets) that Bulgarian has none of. */
const letters = /[ёыэЁЫЭ]/u;

/** Russian words that look Bulgarian enough to pass unnoticed, with the Bulgarian ones to use. */
const words: Record<string, string> = {
  знаток: "експерт, познавач",
  вопрос: "въпрос",
  ответ: "отговор",
  игрок: "играч",
  уровень: "ниво",
  сейчас: "сега",
  пожалуйста: "моля",
  спасибо: "благодаря",
};
const word = new RegExp(`(?<!\\p{L})(${Object.keys(words).join("|")})(?!\\p{L})`, "iu");

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* files(path);
    else if (kinds.test(e.name) && !e.name.endsWith("language.test.ts")) yield path;
  }
}

test("everything a player may read is in Bulgarian letters and words", () => {
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
        });
    }
  }
  assert.deepEqual(found, []);
});
