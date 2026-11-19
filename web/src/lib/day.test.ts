import assert from "node:assert/strict";
import { test } from "node:test";
import { dayInBulgaria, hourInBulgaria } from "./day.ts";

test("the day is Bulgaria's: it turns at midnight in Sofia", () => {
  assert.equal(dayInBulgaria(new Date("2026-12-14T21:59:00Z")), "2026-12-14");
  assert.equal(dayInBulgaria(new Date("2026-12-14T22:00:00Z")), "2026-12-15"); // midnight in Sofia: +2
  assert.equal(dayInBulgaria(new Date("2027-07-01T20:59:00Z")), "2027-07-01"); // summer: +3
});

test("the hour is Bulgaria's, summer and winter", () => {
  assert.equal(hourInBulgaria(new Date(Date.UTC(2026, 0, 10, 15, 30))), 17); // winter: +2
  assert.equal(hourInBulgaria(new Date(Date.UTC(2026, 6, 10, 15, 30))), 18); // summer: +3
  assert.equal(hourInBulgaria(new Date(Date.UTC(2026, 6, 10, 21, 0))), 0); // midnight, not 24
});
