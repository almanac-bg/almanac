import assert from "node:assert/strict";
import { test } from "node:test";
import { hourInBulgaria, yearNow } from "./year.ts";

test("a year's look back opens on 15 December, in Bulgaria, and is fresh until 15 January", () => {
  assert.deepEqual(yearNow(new Date("2026-11-14T12:00:00Z")), { year: 0, fresh: false });
  assert.deepEqual(yearNow(new Date("2026-12-14T21:59:00Z")), { year: 0, fresh: false });
  assert.deepEqual(yearNow(new Date("2026-12-14T22:00:00Z")), { year: 2026, fresh: true }); // midnight in Sofia
  assert.deepEqual(yearNow(new Date("2027-01-15T12:00:00Z")), { year: 2026, fresh: true });
  assert.deepEqual(yearNow(new Date("2027-01-16T12:00:00Z")), { year: 2026, fresh: false });
  assert.deepEqual(yearNow(new Date("2027-07-01T12:00:00Z")), { year: 2026, fresh: false });
  assert.deepEqual(yearNow(new Date("2027-12-20T12:00:00Z")), { year: 2027, fresh: true });
});

test("the hour is Bulgaria's, summer and winter", () => {
  assert.equal(hourInBulgaria(new Date(Date.UTC(2026, 0, 10, 15, 30))), 17); // winter: +2
  assert.equal(hourInBulgaria(new Date(Date.UTC(2026, 6, 10, 15, 30))), 18); // summer: +3
  assert.equal(hourInBulgaria(new Date(Date.UTC(2026, 6, 10, 21, 0))), 0); // midnight, not 24
});
