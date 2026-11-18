import assert from "node:assert/strict";
import { test } from "node:test";
import { pastLine, streakLine } from "./issues.ts";

test("a past issue says it's outside the streak, but the one that wins a broken streak back says that", () => {
  assert.equal(streakLine({}), pastLine);
  const repair = { days: 9, day: false, missed: [{ issue: 6, done: true }], words: "" };
  assert.equal(streakLine({ repair }), "Този брой връща серията ти от 9 дни заедно с днешните въпроси.");
  assert.equal(
    streakLine({ repair: { ...repair, words: "пропуснатия брой от 18 ноември" } }),
    "Този брой връща серията ти от 9 дни заедно с днешните въпроси и пропуснатия брой от 18 ноември.",
  );
  assert.equal(streakLine({ mended: 10 }), "С този брой серията ти се върна: 10 дни.");
});
