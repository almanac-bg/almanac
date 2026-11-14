import assert from "node:assert/strict";
import { test } from "node:test";
import { askToKeep, keepLater } from "./keep.ts";

test("a guest who keeps coming back is asked to keep their profile, not again for a week after „По-късно“", () => {
  const now = Date.UTC(2026, 10, 14);
  const guest = { streak: 0, level: 1, laterAt: 0, now };
  assert.equal(askToKeep(guest), false); // new: not yet
  assert.equal(askToKeep({ ...guest, streak: 3 }), true);
  assert.equal(askToKeep({ ...guest, level: 3 }), true);
  assert.equal(askToKeep({ ...guest, streak: 5, email: "a@b.bg" }), false); // kept already
  assert.equal(askToKeep({ ...guest, streak: 5, laterAt: now - 1000 }), false); // put off a moment ago
  assert.equal(askToKeep({ ...guest, streak: 5, laterAt: now - keepLater }), true); // a week on
});
