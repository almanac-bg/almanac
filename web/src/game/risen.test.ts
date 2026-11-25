// The ranks risen in a result's news, in words (news.ts, risen): a list the Bulgarian way, each chapter with its own
// „в“ (held to the name by a no-break space, here a space) and „и“ only before the last, since four chapters' names
// have an „и“ of their own („Кино и телевизия“).
import assert from "node:assert/strict";
import { test } from "node:test";

// The page ui.ts loads into, as little of it as it reads as it loads.
Object.assign(globalThis, {
  location: { pathname: "/", search: "", hash: "" },
  document: { addEventListener: () => {}, getElementById: () => null, documentElement: { dataset: {} } },
});
const { risen } = await import("./news.ts");

const words = (...ranks: [string, string][]) =>
  risen(
    ranks.map(([name, chapter]) => ({ name, chapter, to: 2 })),
    (c) => `[${c}]`,
  )
    .join("")
    .replaceAll("\u00a0", " ");

test("one chapter, two and three, each with its „в“ and „и“ only before the last", () => {
  assert.equal(words(["Страница", "history"]), "„Страница“ в [history]");
  assert.equal(words(["Страница", "history"], ["Страница", "movies"]), "„Страница“ в [history] и в [movies]");
  assert.equal(
    words(["Страница", "history"], ["Страница", "movies"], ["Страница", "sports"]),
    "„Страница“ в [history], в [movies] и в [sports]",
  );
  const raw = risen([{ name: "Страница", chapter: "history", to: 2 }], (c) => c).join("");
  assert.equal(raw, "„Страница“ в\u00a0history", "„в“ never at a line's end");
});

test("each rank once with its chapters, „а“ before the last rank", () => {
  assert.equal(
    words(["Тетрадка", "history"], ["Страница", "geography"], ["Страница", "science"]),
    "„Тетрадка“ в [history], а „Страница“ в [geography] и в [science]",
  );
  assert.equal(
    words(["Книга", "music"], ["Тетрадка", "history"], ["Страница", "science"]),
    "„Книга“ в [music], „Тетрадка“ в [history], а „Страница“ в [science]",
  );
});
