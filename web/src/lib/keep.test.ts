import assert from "node:assert/strict";
import { test } from "node:test";
import { askToKeep, keptWords } from "./keep.ts";

test("a guest is asked to keep their game from the second day, and at once in an app's own browser", () => {
  const guest = { days: 1, embedded: false };
  assert.equal(askToKeep(guest), false); // a first day: not yet
  assert.equal(askToKeep({ ...guest, days: 2 }), true);
  assert.equal(askToKeep({ ...guest, embedded: true }), true); // Messenger's browser: the first day
  assert.equal(askToKeep({ ...guest, days: 2, email: "a@b.bg" }), false); // kept already
  assert.equal(askToKeep({ ...guest, embedded: true, email: "a@b.bg" }), false);
});

test("the code put in says what came of it: a guest's game kept, or the profile it joined", () => {
  const guest = { id: 7, name: "Таралеж 123" };
  assert.equal(
    keptWords(guest, { ...guest, email: "ana@example.bg" }),
    "Готово. Играта ти е запазена с имейла ana@example.bg. Влизай с него от всяко устройство.",
  );
  const ana = { id: 3, name: "Ана", email: "ana@example.bg" };
  assert.equal(keptWords(guest, ana), "Влезе като Ана. Играта оттук е добавена към профила ти.");
  assert.equal(keptWords(null, ana), "Влезе като Ана.");
});
