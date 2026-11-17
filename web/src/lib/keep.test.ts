import assert from "node:assert/strict";
import { test } from "node:test";
import { askToKeep } from "./keep.ts";

test("a guest is asked to keep their game from the second day, and at once in an app's own browser", () => {
  const guest = { days: 1, embedded: false };
  assert.equal(askToKeep(guest), false); // a first day: not yet
  assert.equal(askToKeep({ ...guest, days: 2 }), true);
  assert.equal(askToKeep({ ...guest, embedded: true }), true); // Messenger's browser: the first day
  assert.equal(askToKeep({ ...guest, days: 2, email: "a@b.bg" }), false); // kept already
  assert.equal(askToKeep({ ...guest, embedded: true, email: "a@b.bg" }), false);
});
