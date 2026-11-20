import assert from "node:assert/strict";
import { test } from "node:test";
import { milestoneAhead } from "./almanac.ts";

test("the streak's next milestone is dated by today's ten: played, it counts; still to play, today is the next day", () => {
  // Five days with today played: the seventh is two days on.
  assert.deepEqual(milestoneAhead(5, true, "2026-11-20"), { n: 7, day: "2026-11-22" });
  // Five days to yesterday, today still to play: today is the sixth, the seventh tomorrow.
  assert.deepEqual(milestoneAhead(5, false, "2026-11-20"), { n: 7, day: "2026-11-21" });
  // Six days to yesterday: today's ten make the seventh, today.
  assert.deepEqual(milestoneAhead(6, false, "2026-11-20"), { n: 7, day: "2026-11-20" });
  // Across a month and a year.
  assert.deepEqual(milestoneAhead(7, true, "2026-12-20"), { n: 30, day: "2027-01-12" });
});

test("no milestone ahead without a streak, or past the last", () => {
  assert.equal(milestoneAhead(0, false, "2026-11-20"), undefined);
  assert.equal(milestoneAhead(400, true, "2026-11-20"), undefined);
  assert.deepEqual(milestoneAhead(100, true, "2026-11-20")?.n, 365);
});
