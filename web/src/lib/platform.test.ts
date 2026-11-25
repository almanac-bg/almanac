import assert from "node:assert/strict";
import { test } from "node:test";
import { appleTouch } from "./platform.ts";

const iPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const mac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const android =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

test("an iPhone, and an iPad that says it's a Mac, are told apart from a Mac by touch", () => {
  assert.equal(appleTouch(iPhone, 5), true);
  assert.equal(appleTouch(mac, 5), true); // an iPad's Safari, as it comes
  assert.equal(appleTouch(mac, 0), false);
  assert.equal(appleTouch(android, 5), false);
});
